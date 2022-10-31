/*
* Copyright (c) 2019 - present Nimbella Corp.
*
* This file is licensed to you under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License. You may obtain a copy
* of the License at http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software distributed under
* the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
* OF ANY KIND, either express or implied. See the License for the specific language
* governing permissions and limitations under the License.
*/

import {
  DeployStructure, DeployResponse, DeploySuccess, DeployKind, ActionSpec, PackageSpec, Feedback,
  DeployerAnnotation, VersionMap, VersionEntry, PathKind, ProjectReader, KeyVal
} from './deploy-struct'
import { getUserAgent } from './api'
import { XMLHttpRequest } from 'xmlhttprequest'
import { Client, Dict, Activation, Action } from 'openwhisk'
import { isValidCron } from 'cron-validator'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import simplegit from 'simple-git'
import * as randomstring from 'randomstring'
import * as crypto from 'crypto'
import * as yaml from 'js-yaml'
import makeDebug from 'debug'
import anymatch from 'anymatch'
import { parseGithubRef } from './github'
import { nimbellaDir } from './credentials'
import { isBinaryFileExtension, runtimeForZipMid, runtimeForFileExtension, RuntimesConfig, isValidRuntime} from './runtimes'
import { undeployTriggers, listTriggersForNamespace } from './triggers'
const debug = makeDebug('nim:deployer:util')

// List of files/paths to be ignored, add https://github.com/micromatch/anymatch compatible definitions
export const SYSTEM_EXCLUDE_PATTERNS = ['.gitignore', '.DS_Store', '**/.git/**',
  (s: string): boolean => s.includes('.nimbella'),
  (s: string): boolean => s.includes('.deployed'),
  (s: string): boolean => s.includes('_tmp_'),
  (s: string): boolean => s.includes('.#'),
  (s: string): boolean => s.endsWith('~'),
  '**/*.swp',
  '**/*.swx'
]

//
// General utilities
//

// Read the project config file, with validation
export async function loadProjectConfig(configFile: string, envPath: string, buildEnvPath: string, filePath: string, reader: ProjectReader,
  feedback: Feedback): Promise<DeployStructure> {
  return reader.readFileContents(configFile).then(async data => {
    try {
      // Read the config, substituting from env
      const { content, badVars } = substituteFromEnvAndFiles(String(data), envPath, filePath, feedback)
      let config: Record<string, any>
      if (configFile.endsWith('.json')) {
        config = JSON.parse(content)
      } else {
        if (content.includes('\t')) {
          throw new Error('YAML configuration may not contain tabs')
        } else {
          config = yaml.safeLoad(content) as Record<string, any>
        }
      }
      if (!config) {
        throw new Error('configuration is empty or unparseable')
      }
      // Adjust from the external convention (packages contain functions) to the internal one
      // (packages contain actions).
      renameFunctionsToActions(config)

      // Add build environment if specified
      if (buildEnvPath) {
        config.buildEnv = getPropsFromFile(buildEnvPath)
      }

      config.unresolvedVariables = badVars
      if (badVars && badVars.length > 0) {
        const formatted = "'" + badVars.join("', '") + "'"
        config.error =  new Error('The following substitutions could not be resolved: ' + formatted)
      }

      // Check config
      const configError = await validateDeployConfig(config)
      if (configError) {
        throw new Error(configError)
      } else {
        removeEmptyStringMembers(config)
      }      
      return config
    } catch (err) {
      const errMsgPrefix = `Invalid project configuration file (${configFile})`
      if (err.message) {
        err.message = `${errMsgPrefix}: ${err.message}`
      } else {
        err.message = `${errMsgPrefix}`
      }
      return errorStructure(err)
    }
  })
}

// Rename any 'functions' members of the contained PackageSpecs of a config to 'actions'.
// This adjust from an external convention to an internal one.  It is done before validation.
function renameFunctionsToActions(config: Record<string, any>): void {
  if (config.packages) {
    for (const pkg of config.packages) {
      if (pkg.functions) {
        pkg.actions = pkg.functions
        delete pkg.functions
      }
    }
  }
}

// Rename any 'actions' members of the contained PackageSpecs of a config to 'functions'.
// This adjust from an external convention to an internal one.  It is done before writing out
// a config to be visible to users.
export function renameActionsToFunctions(config: Record<string, any>): void {
  if (config.packages) {
    for (const pkg of config.packages) {
      if (pkg.actions) {
        pkg.functions = pkg.actions
        delete pkg.actions
      }
    }
  }
}

// Check whether a build field actually implies a build must be run
export function isRealBuild(buildField: string): boolean {
  switch (buildField) {
    case 'build.sh':
    case 'build.cmd':
    case 'package.json':
      return true
    default:
      return false
  }
}

// Replace a build field with 'remote' or 'remote-default' if it is supposed to be remote according to flags,
// directives, environment, or the type of runtime.
function locateBuild(buildField: string, remoteRequested: boolean, defaultRemote: boolean,
  remoteRequired: boolean, localRequired: boolean) {
  if (!isRealBuild(buildField)) {
    // Not a real build. Check remote-default conditions.
    if (defaultRemote && !localRequired) {
      return 'remote-default'
    } // else does not meet remote-default conditions
    return buildField
  } // else it's a real build. Check conditions for remote.
  if (remoteRequired || (remoteRequested && !localRequired)) {
    return 'remote'
  } // else does not meet conditions for remote
  return buildField
}

// Set up the build fields for a project and detect conflicts.  Determine if local building is required.
export async function checkBuildingRequirements(todeploy: DeployStructure, requestRemote: boolean): Promise<boolean> {
  const checkConflicts = (buildField: string, remote: boolean, local: boolean, tag: string) => {
    if (remote && local) {
      throw new Error(`Local and remote building cannot both be required (${tag})`)
    }
  }
  if (todeploy.packages) {
    for (const pkg of todeploy.packages) {
      if (pkg.actions) {
        for (const action of pkg.actions) {
          checkConflicts(action.build, action.remoteBuild, action.localBuild, `action ${action.name}`)
        }
      }
    }
  }
  let needsLocal = false
  if (todeploy.packages) {
    for (const pkg of todeploy.packages) {
      if (pkg.actions) {
        for (const action of pkg.actions) {
          const defaultRemote = await hasDefaultRemote(action, todeploy.reader)
          action.build = locateBuild(action.build, requestRemote, defaultRemote, action.remoteBuild, action.localBuild)
          needsLocal = needsLocal || (!action.build?.startsWith('remote') && isRealBuild(action.build))
        }
      }
    }
  }
  return needsLocal
}

// Determine if an action has a default remote build.  This depends on the action's 'kind': currently, swift and go have a
// default remote build while other languages do not.   This function is designed to be called before the runtime is otherwise
// known so it is prepared to peek into the project to figure out the operative runtime.
async function hasDefaultRemote(action: ActionSpec, reader: ProjectReader): Promise<boolean> {
  const runtime = await getRuntimeForAction(action, reader)
  if (!runtime) {
    return false 
  }
  const kind = runtime.split(':')[0]
  switch (kind) {
    // TODO should this be an external table?
    case 'go':
    case 'swift':
      return true
    default:
      return false
  }
}

export async function getRuntimeForAction(action: ActionSpec, reader: ProjectReader): Promise<string> {
  if (action.runtime) {
    return action.runtime
  }
  if (action.sequence && action.sequence.length > 0) {
    return ''
  }
  const pathKind = await reader.getPathKind(action.file)
  if (pathKind.isFile) {
    let runtime: string
    ({ runtime } = await actionFileToParts(pathKind.name))
    return runtime
  } else if (pathKind.isDirectory) {
    const files = await promiseFilesAndFilterFiles(action.file, reader)
    return agreeOnRuntime(files)
  } else {
    return ''
  }
}

// Check whether a list of names that are candidates for zipping can agree on a runtime.  This is called only when the
// config doesn't already provide a runtime or on the raw material in the case of remote builds.
export async function agreeOnRuntime(items: string[]): Promise<string> {
  let agreedRuntime: string
  items.forEach(async item => {
    const { runtime } = await actionFileToParts(item)
    if (runtime) {
      if (agreedRuntime && runtime !== agreedRuntime) {
        return undefined
      }
      agreedRuntime = runtime
    }
  })
  return agreedRuntime
}

// In project config we permit many optional string-valued members to be set to '' to remind users that they are available
// without actually setting a value.  Here we delete those members to simplify subsequent handling.
function removeEmptyStringMembers(config: DeployStructure) {
  if (config.targetNamespace && config.targetNamespace === '') {
    delete config.targetNamespace
  }
  removeEmptyStringMembersFromPackages(config.packages)
}

// Remove empty optional string-valued members from an array of PackageSpecs
function removeEmptyStringMembersFromPackages(packages: PackageSpec[]) {
  if (!packages) return
  for (const pkg of packages) {
    if (pkg.actions) {
      for (const action of pkg.actions) {
        if (action.main && action.main === '') {
          delete action.main
        }
        if (action.runtime && action.runtime === '') {
          delete action.runtime
        }
      }
    }
  }
}

// Validation for DeployStructure read from disk.
export async function validateDeployConfig(arg: any): Promise<string> {
  const isNimbellaDeploy = arg.targetNamespace === 'nimbella'
  const slice = !!arg.slice
  for (const item in arg) {
    if (!arg[item]) continue
    switch (item) {
      case 'slice':
        continue
      case 'cleanNamespace':
        if (!(typeof arg[item] === 'boolean')) {
          return `${item} must be a boolean`
        }
        break
      case 'targetNamespace': {
        if (!(typeof (arg[item]) === 'string') && !isValidOwnership(arg[item])) {
          return `${item} must be a string or a dictionary containing 'test' and/or 'production' members`
        }
        break
      }
      case 'packages': {
        if (!Array.isArray(arg[item])) {
          return 'packages member must be an array'
        }
        for (const subitem of arg[item]) {
          const pkgError = await validatePackageSpec(subitem, slice, isNimbellaDeploy)
          if (pkgError) {
            return pkgError
          }
        }
        break
      }
      case 'parameters':
      case 'environment': {
        if (!isDictionary(arg[item])) {
          return `${item} member must be a dictionary`
        }
        break
      }
      case 'credentials':
      case 'flags':
      case 'deployerAnnotation':
      case 'buildEnv':
        if (slice) continue
      // In a slice we accept these without further validation; otherwise, they are illegal
      // Otherwise, fall through
      default:
        return `Invalid key '${item}' found in project.yml`
    }
  }
  return undefined
}

// Test whether an item is a dictionary.  In practice this means its basic type is object and it isn't an array or null.
function isDictionary(item: any) {
  return typeof item === 'object' && !Array.isArray(item) && item != null
}

// Test whether an item is an Ownership.  This means it's a dictionary and has 'production' and/or 'test' string members
function isValidOwnership(item: any): boolean {
  return isDictionary(item) && (typeof item.production === 'string' || typeof item.test === 'string')
}

// Validator for a PackageSpec
async function validatePackageSpec(arg: Record<string, any>, slice: boolean, isNimbella: boolean): Promise<string> {
  const isDefault = arg.name === 'default'
  for (const item in arg) {
    if (!arg[item]) continue
    if (item === 'name') {
      if (!(typeof arg[item] === 'string')) {
        return `'${item}' member of a 'package' must be a string`
      }
    } else if (item === 'actions') {
      if (!Array.isArray(arg[item])) {
        return "actions member of a 'package' must be an array"
      }
      for (const subitem of arg[item]) {
        const actionError = await validateActionSpec(subitem, isNimbella)
        if (actionError) {
          return actionError
        }
      }
    } else if (item === 'shared' || item === 'clean') {
      if (!(typeof arg[item] === 'boolean')) {
        return `'${item}' member of a 'package' must be a boolean`
      } else if (isDefault && arg[item]) {
        return `'${item}' must be absent or false for the default package`
      }
    } else if (item === 'web') {
      if (!(typeof arg[item] === 'boolean' || arg[item] === 'raw')) {
        return `${item} member of an 'package' must be a boolean or the string 'raw'`
      }
    } else if (item === 'environment') {
      const envErr = validateEnvironment(arg[item])
      if (envErr) {
        return envErr
      }
    } else if (item === 'parameters' || item === 'annotations') {
      if (!isDictionary(arg[item])) {
        return `${item} must be a dictionary`
      }
      if (isDefault && Object.keys(arg[item]).length > 0) {
        return `'${item}' must be absent or empty for the default package`
      }
    } else if (item === 'deployedDuringBuild' && slice) {
      continue
    } else {
      return `Invalid key '${item}' found in 'package' in project.yml`
    }
  }
  return undefined
}

// Validator for ActionSpec
async function validateActionSpec(arg: Record<string, any>, isNimbella: boolean): Promise<string> {
  for (const item in arg) {
    if (!arg[item]) continue
    switch (item) {
      case 'name':
      case 'file':
      case 'runtime':
      case 'main':
      case 'docker':
        if (!(typeof arg[item] === 'string')) {
          return `'${item}' member of an 'action' must be a string`
        }
        if (item === 'runtime' && !await isValidRuntime(arg[item])) {
          return `'${arg[item]}' is not a valid runtime value`
        }
        break
      case 'binary':
      case 'clean':
      case 'remoteBuild':
      case 'localBuild':
        if (!(typeof arg[item] === 'boolean')) {
          return `'${item}' member of an 'action' must be a boolean`
        }
        break
      case 'sequence':
        if (!Array.isArray(arg[item]) || arg[item].length === 0 || (typeof arg[item][0]) !== 'string') {
          return `'${item}' member of an 'action' must be an array of one or more strings naming actions`
        }
        break
      case 'web':
        if (!(typeof arg[item] === 'boolean' || arg[item] === 'raw')) {
          return `${item} member of an 'action' must be a boolean or the string 'raw'`
        }
        break
      case 'webSecure':
        if (isNimbella && arg[item] === true) {
          // allowed
          continue
        }
        if (!(arg[item] === false || typeof arg[item] === 'string')) {
          return `'${item}' member of an 'action' must be a boolean false or a string`
        }
        break
      case 'environment': {
        const envError = validateEnvironment(arg[item])
        if (envError) {
          return envError
        }
      }
      // falls through
      case 'annotations': {
        if (!isDictionary(arg[item])) {
          return `${item} must be a dictionary`
        }
        const annotErr = screenForbiddenAnnotations(arg[item])
        if (annotErr) {
          return annotErr
        }
        break
      }
      case 'parameters':
        if (!isDictionary(arg[item])) {
          return `${item} must be a dictionary`
        }
        break
      case 'limits': {
        const limitsError = validateLimits(arg[item])
        if (limitsError) {
          return limitsError
        }
        break
      }
      case 'triggers': {
        const trigErr = validateTriggers(arg[item])
        if (trigErr) {
          return trigErr
        }
        break
      }
      default:
        return `Invalid key '${item}' found in 'action' clause in project.yml`
    }
  }
  return undefined
}

// Don't permit manual setting of annotations that are supposed to be set specially
function screenForbiddenAnnotations(annots: object): string {
  const forbidden = {
    'require-whisk-auth': 'webSecure',
    'web-export': 'web=true|false|"raw"',
    'raw-http': 'web=raw'
  }
  for (const annot of Object.keys(annots)) {
    const subst = forbidden[annot]
    if (subst) {
      return `the '${annot}' annotation may not be set explicitly; use '${subst}'` 
    }
  }
  return ''
}

// Validator for the 'triggers' clause of an action
function validateTriggers(arg: any): string {
  if (!Array.isArray(arg)) {
    return `a 'triggers' clause must be an array`
  }
  for (const trigger of arg) {
    if (!isDictionary(trigger)) {
      return 'an individual trigger must be a dictionary'
    }
    let name = false, sourceType = false, sourceDetails = false
    for (const item in trigger) {
      const value = trigger[item]
        switch(item) {
          case 'name':
            if (typeof value !== 'string') {
              return `a trigger name must be a string but the provided type is'${typeof value}'`
            }
            name = true
            break          
          case 'sourceType':
            if (value !== 'scheduler') {
              return `only triggers with sourcetype 'scheduler' are supported at this time`
            }
            sourceType = true
            break
          case 'sourceDetails': {
            // TODO more dispatching will be needed here when more sourceTypes are supported
            const schedErr = validateSchedulerSourceDetails(value)
            if (schedErr) {
              return schedErr
            }
            sourceDetails = true
            break
          }
          case 'overwrite':
          case 'enabled':
            if (typeof value !== 'boolean') {
              return `the '${item}' property of a trigger must be boolean'`
            }
            break
          default:
            return `Invalid key '${item}' found in 'triggers' clause in project.yml`
        }
     }
     if (!name) {
       return `the 'name' field of a trigger is required`   
     }
     if (!sourceType) {
       return `the 'sourceType' field of a trigger required`   
     }
     if (!sourceDetails) {
       return `the 'sourceDetails' property of a trigger is required`   
    }
  }
  return undefined
}

// Validator for the sourceDetails of a trigger when the sourceType is 'scheduler'
function validateSchedulerSourceDetails(arg: any): string {
  if (!isDictionary(arg)) {
    return 'the sourceDetails field of a trigger specification must be a dictionary'
  }
  let timeFound = false
  for (const item in arg) {
    const value = arg[item]
    switch (item) {
      case 'cron':
        timeFound = true
        if (typeof value !== 'string') {
          return `the 'cron' member of scheduler 'sourceDetails' must be a string`
        }
        if (!isValidCron(value)) {
          // Note we are now validating with no "special options" enabled, so this is
          // least-common-denominator crontab (no seconds, no aliases, etc.).  We should make sure
          // we are at least considering valid anything that the scheduler will actually accept.
          return `the cron expression '${value}' is not valid crontab syntax`
        }
        break
      case 'interval':
      case 'once':
        // TODO validate properly once implemented.  Eventually check that only one
        // of cron, interval or once is specified.
        return `the ${item} member of scheduler sourceDetails is defined but not yet implemented`
      case 'withBody':
        if (!isDictionary(value)) {
          return `the 'withBody' member of scheduler sourceDetails must be a dictionary`
        }
        break
      default:
        return `Invalid key '${item}' found in scheduler 'sourceDetails' in project.yml`
    }
  }
  if (!timeFound) {
    return `no trigger time was specified for a trigger with sourcetype 'scheduler'`
  }  
  return undefined
}

// Validator for the 'environment' clause of package or action.  Checks that all values are strings
function validateEnvironment(item: any): string {
  if (!isDictionary(item)) {
    return 'the environment clause must be a dictionary'
  }
  for (const entry in item) {
    const value = item[entry]
    if (typeof value !== 'string') {
      return `All environment values must be strings but '${entry}' has type '${typeof value}'`
    }
  }
  return undefined
}

// Validator for the limits clause
function validateLimits(arg: any): string {
  for (const item in arg) {
    const value = arg[item]
    switch (item) {
      case 'timeout':
      case 'memory':
      case 'logs':
        if (typeof value !== 'number') {
          return `'${item}' member of a 'limits' clause must be a number`
        }
        break
      default:
        return `Invalid key '${item}' found in 'limits' clause in project.yml`
    }
  }
  return undefined
}

// Convert convenient "Dict" to the less convenient "KeyVal[]" required in an action object
export function keyVal(from: Dict): KeyVal[] {
  if (!from) {
    return undefined
  }
  return Object.keys(from).map(key => ({ key, value: from[key] }))
}

// Make an openwhisk KeyVal into an openwhisk Dict (the former appears in Action and Package, the latter in ActionSpec and PackageSpec)
export function makeDict(keyVal: KeyVal[]): Dict {
  const ans: Dict = {}
  keyVal.forEach(pair => {
    ans[pair.key] = pair.value
  })
  return ans
}

// Provide an empty DeployStructure with all array and object members defined but empty
export function emptyStructure(): DeployStructure {
  return { packages: [], strays: [] }
}

// Provide an empty DeployStructure that records an error
export function errorStructure(err: Error): DeployStructure {
  const ans = emptyStructure()
  ans.error = err
  return ans
}

// Provide an empty DeployResponse with all required members defined but empty
export function emptyResponse(): DeployResponse {
  return { successes: [], failures: [], ignored: [], namespace: undefined, packageVersions: {}, actionVersions: {} }
}

// Combine multiple DeployResponses into a single DeployResponse
export function combineResponses(responses: DeployResponse[]): DeployResponse {
  if (responses.length === 0) {
    return emptyResponse()
  }
  const combinedSuccesses: DeploySuccess[][] = responses.map(response => response.successes)
  const successes = combinedSuccesses.reduce((prev, curr) => prev.concat(curr), [])
  const combinedFailures: Error[][] = responses.map(response => response.failures)
  const failures = combinedFailures.reduce((prev, curr) => prev.concat(curr), [])
  const combinedIgnored: string[][] = responses.map(response => response.ignored)
  const ignored = combinedIgnored.reduce((prev, curr) => prev.concat(curr))
  const packageVersions = responses.reduce((prev, curr) => Object.assign(prev, curr.packageVersions), {})
  const actionVersions = responses.reduce((prev, curr) => Object.assign(prev, curr.actionVersions), {})
  const webHashes = responses.reduce((prev, curr) => Object.assign(prev, curr.webHashes || {}), {})
  const namespace = responses.map(r => r.namespace).reduce((prev, curr) => prev || curr)
  return { successes, failures, ignored, packageVersions, actionVersions, webHashes, namespace }
}

// Turn the strays from a DeployStructure into a response indicating that they were skipped
export function straysToResponse(strays: string[]): DeployResponse {
  return {
    successes: [],
    ignored: strays,
    failures: [],
    packageVersions: {},
    actionVersions: {},
    namespace: undefined
  }
}

// Wrap a single success as a DeployResponse
export function wrapSuccess(name: string, kind: DeployKind, skipped: boolean, actionVersions: VersionMap,
  namespace: string): DeployResponse {
  const success: DeploySuccess = { name, kind, skipped }
  return { successes: [success], failures: [], ignored: [], namespace, packageVersions: {}, actionVersions }
}

// Wrap a single error as a DeployResponse
export function wrapError(err: any, context: string): DeployResponse {
  debug('wrapping an error: %O', err)
  if (typeof err === 'object') {
    err.context = context
  }
  const result = { successes: [], failures: [err], ignored: [], packageVersions: {}, actionVersions: {}, namespace: undefined }
  debug('wrapped error: %O', result)
  return result
}

// Compute an appropriately qualified action name based on package inclusion
export function getActionName(action: ActionSpec): string {
  if (action.package && action.package !== 'default') {
    return action.package + '/' + action.name
  } 
  return action.name
}

// Check whether the namespace for an OW client's current auth matches a desired target
export function isTargetNamespaceValid(client: Client, namespace: string): Promise<boolean> {
  return getTargetNamespace(client).then(ns => {
    if (ns === namespace) {
      return Promise.resolve(true)
    } else {
      throw new Error(`Supplied credentials do not match target namespace '${namespace}'; deployment aborted`)
    }
  })
}

// Get the target namespace
export function getTargetNamespace(client: Client): Promise<string> {
  return client.namespaces.list().then(ns => ns[0])
}

// Process an action file name, producing 'name', 'binary', 'zipped' and 'runtime' parts
export async function actionFileToParts(fileName: string): Promise<{ name: string, binary: boolean, zipped: boolean, runtime: string }> {
  let runtime: string
  let binary: boolean
  let zipped: boolean
  let name = path.basename(fileName)
  const split = name.indexOf('.')
  if (split > 0) {
    const parts = name.split('.')
    const ext = parts[parts.length - 1]
    let mid: string
    if (parts.length === 2) {
      name = parts[0]
    } else if (ext === 'zip') {
      [name, mid] = getNameAndMid(parts.slice(0, -1))
    } else {
      name = parts.slice(0, -1).join('.')
    }
    runtime = mid ? await runtimeForZipMid(mid) : runtimeForFileExtension(ext)
    binary = isBinaryFileExtension(ext)
    zipped = ext === 'zip'
  } else {
    // No extension.  Assume binary, with unknown runtime
    binary = true
    zipped = false
  }
  const z = zipped ? '' : 'not '
  debug(`action ${name} is ${z}zipped`)
  return { name, binary, zipped, runtime }
}

// Correctly parse a "mid" segment from a zip file name.  The input is the name split
// on periods with the extension dropped.  There are always at least two parts.
// We should return the name and mid-segment as a two-element array.
function getNameAndMid(parts: string[]): string[] {
  if (parts.length === 2) {
    return parts
  }
  // There are at least three parts.  Either the runtime is the last one or the last two
  const last = parts[parts.length - 1]
  const nextToLast = parts[parts.length - 2]
  if (/^\d+$/.test(last) && nextToLast.includes('-')) {
    // Looks like a runtime version was split on a dot so we need to reassemble
    const name = parts.slice(0, -2).join('.')
    const mid = parts.slice(-2).join('.')
    return [name, mid]
  } else {
    const name = parts.slice(0, -1).join('.')
    return [name, last]
  }
}

// Filters temp files from an array of Dirent structures
export function filterFiles(entries: PathKind[]): PathKind[] {
  return entries.filter(entry => {
    if (!entry.isDirectory) {
      return !anymatch(getExclusionList(), entry.name)
    } else {
      return entry
    }
  })
}

// Emulates promiseFiles (from node-dir) using a ProjectReader and adds filtering like filterFiles
export async function promiseFilesAndFilterFiles(root: string, reader: ProjectReader): Promise<string[]> {
  let items = await promiseFiles(root, reader)
  debug('items before filtering: %O', items)
  const exclusions = getExclusionList()
  debug('exclusion list: %O', exclusions)
  items = items.filter((item: string) => !anymatch(exclusions, item))
  debug('items after filtering: %O', items)
  return items
}

// Emulate promiseFiles using a ProjectReader
async function promiseFiles(dir: string, reader: ProjectReader): Promise<string[]> {
  debug('promiseFiles called on directory %s', dir)
  const files: string[] = []
  let subdirs = await promiseFilesRound(dir, files, [], reader)
  while (subdirs.length > 0) {
    const next = subdirs.pop()
    debug("promiseFiles recursing on subdirectory '%s', with '%d' files accumulated and '%d' subdirectories still pending",
      next, files.length, subdirs.length)
    subdirs = await promiseFilesRound(next, files, subdirs, reader)
  }
  debug('promiseFiles returning with %d files', files.length)
  return files
}

// Working subroutine of promiseFiles
async function promiseFilesRound(dir: string, files: string[], subdirs: string[], reader: ProjectReader): Promise<string[]> {
  const items = await reader.readdir(dir)
  items.forEach(async item => {
    const itemPath = path.join(dir, item.name)
    if (item.isDirectory) {
      subdirs.push(itemPath)
    } else {
      files.push(itemPath)
    }
  })
  return subdirs
}

// Substitute from the environment and from files.  Variable references look like template variables: ${FOO} reads the
// contents of variable FOO.  Variables may be found in the process environment (higher precedence) or in the property file
// located at 'envPath' (lower precedence, and only if 'envPath is defined).
// ${<path} reads the contents of a file at the given path relative to the project root.
// The semantics of variable substitution are purely textual (whatever is in the variable is substituted).
// The semantics of file substitution are richer (see getSubstituteFromFile)
// The form ${ token1 token2 token3 } where tokens are non-whitespace separated by whitespace is a special shorthand
// that expands to { token1: value, token2: value, token3: value } where the values are obtained by looking up the
// tokens in the process environment (higher precedence) or property file located at 'envPath'.
export function substituteFromEnvAndFiles(input: string, envPath: string, projectPath: string, feedback: Feedback): {content: string, badVars: string[]} {
  let result = '' // Will accumulate the result
  const badVars: string[] = [] // Will accumulate failures to resolve
  const props = envPath ? getPropsFromFile(envPath) : {}
  debug('envPath: %s', envPath)
  debug('props %O', props)
  let nextSym = findNextSymbol(input)
  let warn = false
  while (nextSym.index >= 0) {
    const before = input.substr(0, nextSym.index)
    const after = input.substr(nextSym.index + 2)
    const endVar = after.indexOf(nextSym.terminator)
    if (endVar < 0) {
      throw new Error('Runaway variable name or path directive in project.yml')
    }
    let subst: string
    let doStringEscapes = true
    let envar = after.substr(0, endVar).trim()
    debug('substituting for envar: %s', envar)
    if (nextSym.terminator === ')' || /\s/.test(envar)) {
      warn = warn || nextSym.terminator !== ')'
      subst = getDictionarySubstitution(envar, props, badVars)
    } else if (envar.startsWith('<')) {
      if (nextSym.terminator === ')') {
        throw new Error('Invalid substitution: $(' + envar + ')')
      }
      const fileSubst = path.join(projectPath, envar.slice(1).trim())
      subst = getSubstituteFromFile(fileSubst)
    } else {
      if (envar.startsWith('|')) {
        envar = envar.slice(1).trim()
        doStringEscapes = false
      }
      subst = process.env[envar] || props[envar]
    }
    if (!subst) {
      badVars.push(envar)
      subst = `<${envar}>`
    } else if (doStringEscapes) {
      subst = escapeNewlines(subst)
    }
    debug('substitution is: %s', subst)
    result = result + before + subst
    input = after.substr(endVar + 1)
    nextSym = findNextSymbol(input)
  }
  result = result + input
  if (warn) {
    feedback.warn("Using '${}' for dictionary substitution is now deprecated; use '$()'")
  }
  if (badVars.length > 0) {
    return { content: result, badVars } 
  }
  return { content: result, badVars: undefined }
}

// Perform escaping of newlines.
function escapeNewlines(original: string): string {
  const parts = original.split('\n')
  return parts.join('\\n')
}

// Scan forward for the next symbol introducer
function findNextSymbol(input: string): { index: number, terminator: string } {
  const nextBrace = input.indexOf('${')
  const nextParen = input.indexOf('$(')
  const haveBrace = nextBrace >= 0
  const haveParen = nextParen >= 0
  if (haveBrace) {
    if (haveParen) {
      return nextBrace < nextParen ? { index: nextBrace, terminator: '}' } : { index: nextParen, terminator: ')' }
    } else {
      return { index: nextBrace, terminator: '}' }
    }
  } else if (haveParen) {
    return { index: nextParen, terminator: ')' }
  } else {
    return { index: -1, terminator: '' }
  }
}

// Get one or more substitutions in the form of a dictionary, given one or more tokens separated by whitespace.
// Each token is a symbol to be looked up in the process environment or env file
function getDictionarySubstitution(tokens: string, props: Record<string, unknown>, badVars: string[]): string {
  debug('dictionary substitution with %s', tokens)
  const ans = {}
  for (const tok of tokens.split(/\s+/)) {
    debug('token: %s', tok)
    const value = process.env[tok] || props[tok]
    if (value) {
      ans[tok] = value
    } else {
      badVars.push(tok)
      ans[tok] = `<${tok}>`
    }
  }
  return JSON.stringify(ans)
}

// Get a substitution JSON string from a file.  The file is read and, if it is valid JSON, it is simply used as is.
// Otherwise, it is reparsed as a properties file and the result is converted to JSON.  If the file is neither a valid JSON
// file nor a valid properties file, that is an error.
function getSubstituteFromFile(path: string): string {
  if (!fs.existsSync(path)) {
    return undefined
  }
  const props = getPropsFromFile(path)
  const answer = JSON.stringify(props)
  return answer === '{}' ? undefined : answer
}

// Get properties from a file, which may be a properties file or JSON
// This function does not use the project reader because the environment file is specified separately
function getPropsFromFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {}
  }
  const contents = fs.readFileSync(filePath)
  try {
    return JSON.parse(String(contents))
  } catch {
    // Do nothing
  }
  // It's not JSON, so see if it's a properties file
  const propParser = require('dotenv')
  // The dotenv parser doesn't throw but returns the empty object if malformed
  return propParser.parse(contents)
}

// Types for the map versions of the PackageSpec and ActionSpec types
export interface PackageMap {
  [key: string]: PackageSpec
}
export interface ActionMap {
  [key: string]: ActionSpec
}

// Turn a PackageSpec array into a PackageMap
export function mapPackages(packages: PackageSpec[]): PackageMap {
  const ans: PackageMap = {}
  for (const pkg of packages) {
    ans[pkg.name] = pkg
  }
  return ans
}

// Turn an ActionSpec array into an ActionMap
export function mapActions(actions: ActionSpec[]): ActionMap {
  const ans: ActionMap = {}
  for (const action of actions) {
    ans[action.name] = action
  }
  return ans
}

// Get the best available name for a project for recording.  If project is either in github or in cloned repo
// the name should reflect the github coordinates and not include incidental aspects of the github URL.
// If the project is just in the file system we use its absolute path (best we have)
export function getBestProjectName(project: DeployStructure): string {
  const annot = project.deployerAnnotation
  if (!annot) {
    return project.githubPath || project.filePath
  }
  if (annot.repository) {
    let repo = annot.repository
    if (repo.includes(':')) {
      repo = repo.split(':')[1]
    }
    if (repo.endsWith('.git')) {
      repo = repo.slice(0, -4)
    }
    while (repo.startsWith('/')) {
      repo = repo.slice(1)
    }
    return repo + '/' + annot.projectPath
  }
  return annot.projectPath
}

// Calculate the 'deployer' annotation for inclusion in package and action annotations.  This won't change
// in the course of a deploy run so can be calculated once for inclusion in everything that is deployed.
export async function getDeployerAnnotation(project: string, githubPath: string): Promise<DeployerAnnotation> {
  if (githubPath) {
    return Promise.resolve(deployerAnnotationFromGithub(githubPath))
  }
  const digest = undefined
  try {
    const git = simplegit()
    const root = await git.revparse(['--show-toplevel'])
    const repo = await git.raw(['config', '--get', 'remote.origin.url'])
    const user = (await git.raw(['config', '--get', 'user.email'])).trim()
    const projectPath = path.relative(root, path.resolve(project))
    let commit = await git.revparse(['head'])
    commit = commit.substring(0, 8)
    const status = await git.status()
    if (!status.isClean()) {
      commit += '++'
    }
    return { user, repository: repo.trim(), projectPath, commit, digest }
  } catch {
    const user = os.userInfo().username.trim()
    const projectPath = path.resolve(project)
    return { user, projectPath, digest }
  }
}

function deployerAnnotationFromGithub(githubPath: string): DeployerAnnotation {
  const def = parseGithubRef(githubPath)
  const repository = `github:${def.owner}/${def.repo}`
  return { digest: undefined, user: 'cloud', repository, projectPath: def.path, commit: def.ref || 'master' }
}

// Wipe all the entities from the namespace referred to by an OW client handle.
// This is not guaranteed to succeed but it will attempt to wipe as much as possible,
// returning all errors that occurred.  If an error occurs when removing a trigger that
// is associated with a function, the function is not deleted.
export async function wipe(client: Client): Promise<void> {
  const errors: any[] = []
  // Delete the actions, which will delete associated triggers if possible.  If a trigger
  // cannot be deleted, the action is left also.
  await wipeActions(client, errors)
  debug('Actions wiped')
  // Delete the packages.  Note that if an action deletion failed, the containing
  // package will likely fail also.
  await wipeAll(client.packages, 'Package', errors)
  debug('Packages wiped')
  // There _could_ have been orphaned triggers that were not deleted when we
  // deleted actions (since they were not connected to an existing action).
  // On the other hand, if one or more triggers failed deletion before, they
  // may fail again here, with duplicate errors.  We are tolerating that for the moment.
  const namespace = await getTargetNamespace(client)
  const triggers = await listTriggersForNamespace(namespace, '')
  const errs = await undeployTriggers(triggers, namespace)
  if (errs.length > 0) {
    errors.push(...errs)
  }
  // Delete rules and OpenWhisk triggers for good measure (there really shouldn't be any)
  await wipeAll(client.rules, 'Rule', errors)
  debug('Rules wiped')
  await wipeAll(client.triggers, 'Trigger', errors)
  debug('OpenWhisk triggers wiped')
  // Determine if any errors occurred.  If so, throw them.  We have tried using AggregateError
  // here but ran into perplexing problems.  So, using an ad hoc approach when combining errors.
  if (errors.length > 1) {
    const combined = Error('multiple errors occurred while cleaning the namespace') as any
    combined.errors = errors
    throw combined
  } 
  if (errors.length == 1){
    throw errors[0]
  }
}

// Repeatedly wipe an entity (rule, trigger, or package) from the namespace denoted by the OW client until none are left
// Note that the list function can only return 200 entities at a time).
// Actions are handled differently since they may have triggers associated with them.
async function wipeAll(handle: any, kind: string, errors: any[]) {
  while (true) {
    const entities = await handle.list({ limit: 200 })
    if (entities.length === 0) {
      return
    }
    for (const entity of entities) {
      let name = entity.name
      const nsparts = entity.namespace.split('/')
      if (nsparts.length > 1) {
        name = nsparts[1] + '/' + name
      }
      try {
        await handle.delete(name)
        debug('%s %s deleted', kind, name)
      } catch (err) {
        debug('error deleting %s %s: %O', err)
        errors.push(err)    
      }
    }
  }
}

// Repeatedly wipe actions from the namespace denoted by the OW client until none are left.
// Note that the list function can only return 200 actions at a time.  This is done
// differently from the other entity types because actions can have associated triggers
// which should be deleted first (with the action remaining if the trigger deletion fails).
async function wipeActions(client: Client, errors: any[]) {
  while (true) {
    const actions = await client.actions.list({ limit: 200 })
    if (actions.length === 0) {
      return
    }
    for (const action of actions) {
      let name = action.name
      const nsparts = action.namespace.split('/')
      if (nsparts.length > 1) {
        name = nsparts[1] + '/' + name
      }
      const result = await deleteAction(name, client)
      if (Array.isArray(result)) {
        errors.push(...result)
        debug('error deleting the triggers')
      }
      debug('action %s deleted', name)
    }
  }
}

// Delete an action after first deleting any DigitalOcean triggers that are targeting it.
// If we can't delete the triggers, we don't delete the action (maintains the invariant that
// a trigger should only exist if its invoked function also exists).  This function is not
// intended to throw but to return errors in an array (either errors deleting triggers or an
// error deleting the action).
export async function deleteAction(actionName: string, owClient: Client): Promise<Action|Error[]> {
  // Delete triggers.
  const namespace = await getTargetNamespace(owClient)
  const triggers = await listTriggersForNamespace(namespace, actionName)
  const errs = await undeployTriggers(triggers, namespace)
  if (errs.length > 0) {
    return errs
  }
  try {
    return await owClient.actions.delete({ name: actionName})
  } catch (err) {
    const msg = err.message ? err.message : err
    return [ new Error(`unable to undeploy action '${actionName}': ${msg}`) ]   
  }
}

// Generate a secret in the form of a random alphameric string (TODO what form(s) do we actually support)
export function generateSecret(): string {
  return randomstring.generate()
}

// Guard against accidental deployment to a sensitive namespace on a production host
// Not called if the --production flag was set.
// 'nim install actions' will set this flag.
// The workbench 'project deploy' command will never set this flag
// Developers using the deployProject CLI may set this flag but presumably will only do so by intention.
export function saveUsFromOurselves(namespace: string, apihost: string): boolean {
  let sensitiveNamespaces: string[]
  let productionProjects: string[]
  try {
    sensitiveNamespaces = require('../sensitiveNamespaces.json')
    productionProjects = require('../productionProjects.json')
  } catch (_) {
    // Customers don't need a --production flag ... their auth token defines what they can and can't do
    return false
  }
  return sensitiveNamespaces.includes(namespace) && isProductionProject(apihost, productionProjects)
}

// Determine whether an apihost (given as a string URL) denotes any of a list of projects
function isProductionProject(apihost: string, productionProjects: string[]): boolean {
  const url = new URL(apihost)
  const domain = url.hostname.split('.')[0]
  if (domain === 'api') {
    return true
  }
  const project = domain.replace('api', 'nim')
  return productionProjects.includes(project)
}

// Compute the digest of a PackageSpec
export function digestPackage(pkg: PackageSpec): string {
  const hash = crypto.createHash('sha256')
  digestBoolean(hash, pkg.shared)
  digestBoolean(hash, pkg.clean)
  digestBoolean(hash, pkg.web)
  digestDictionary(hash, pkg.annotations)
  digestDictionary(hash, pkg.parameters)
  digestDictionary(hash, pkg.environment)
  for (const action of pkg.actions || []) {
    hash.update(action.name)
  }
  return String(hash.digest('hex'))
}

function digestBoolean(hash: crypto.Hash, toDigest: boolean) {
  hash.update(String(!!toDigest))
}

function digestStringArray(hash: crypto.Hash, toDigest: string[]) {
  if (toDigest) {
    for (const value of toDigest) {
      hash.update(value) 
    }
  }
}

function digestDictionary(hash: crypto.Hash, toDigest: Record<string, any>) {
  if (toDigest) {
    const keys = Object.keys(toDigest).sort()
    for (const key of keys) {
      hash.update(key)
      const value = toDigest[key]
      switch (typeof value) {
        case 'string':
          hash.update(value)
          break
        case 'boolean':
          digestBoolean(hash, value)
          break
        case 'object':
          digestDictionary(hash, value)
          break
        default: // number, bigint ... and some exotic cases  TODO: need we do better?
          hash.update(String(value))
          break
      }
    }
  }
}

// Compute the digest of an ActionSpec.  Code is provided as a separate argument (code member of the ActionSpec will either be identical or undefined)
export function digestAction(action: ActionSpec, code: string): string {
  const hash = crypto.createHash('sha256')
  digestBoolean(hash, action.clean)
  digestBoolean(hash, action.binary)
  digestBoolean(hash, action.zipped)
  hash.update(String(action.web))
  hash.update(String(action.webSecure))
  digestDictionary(hash, action.annotations)
  digestDictionary(hash, action.parameters)
  digestDictionary(hash, action.environment)
  digestDictionary(hash, action.limits)
  digestStringArray(hash, action.sequence)  
  hash.update(code)
  if (action.main) {
    hash.update(action.main)
  }
  hash.update(action.runtime)
  return String(hash.digest('hex'))
}

// Get the status reporting directory, making it if it doesn't exist
function getStatusDir(project: string): { statusDir: string, created: boolean } {
  const statusDir = path.join(project, '.deployed')
  let created = false
  if (!fs.existsSync(statusDir)) {
    fs.mkdirSync(statusDir)
    created = true
  }
  return { statusDir, created }
}

// Write the "slice result" to the status area
// Note: this is not being used yet.  It is not clear how the remote build action is supposed to find the status area.
// Other possibilities are to write it in a more easily found place or to write it to a file descriptor and pipe it
// somewhere.
export function writeSliceResult(project: string, result: string): void {
  const file = path.join(getStatusDir(project).statusDir, 'sliceResult')
  fs.writeFileSync(file, result)
}

// Called after a deploy step to record important information from the DeployResponse into the project.
// Essentially a dual of loadVersions but not quite symmetrical since its argument is a DeployResponse
// The 'replace' argument causes the new VersionEntry calculated from the DeployResponse to replace
// an existing one.  This was the behavior prior to the advent of include/exclude, and it is what is
// requested when that feature is not used.  If 'replace' is false, then the new VersionEntry is merged
// into an existing one if any, preserving information for things not deployed in the current round.
// Returns the path name of the status directory if newly created, empty string otherwise
export function writeProjectStatus(project: string, results: DeployResponse, replace: boolean): string {
  debug('writing project status with %O', results)
  const { apihost, namespace, packageVersions, actionVersions, webHashes } = results
  if (Object.keys(actionVersions).length === 0 && Object.keys(packageVersions).length === 0 && Object.keys(webHashes).length === 0) {
    debug('there is no meaningful project status to write')
    return ''
  }
  const { statusDir, created } = getStatusDir(project)
  let versionList: VersionEntry[] = []
  const versionFile = path.join(statusDir, 'versions.json')
  if (fs.existsSync(versionFile)) {
    debug('version file already exists')
    const old = JSON.parse(String(fs.readFileSync(versionFile)))
    if (Array.isArray(old)) {
      versionList = old
      debug('version list using legacy format, not preserved')
    } // Otherwise (not array) it is the legacy format and cannot be added to so we just overwrite
  }
  const versionInfo: VersionEntry = { apihost, namespace, packageVersions, actionVersions, webHashes }
  const oldEntry: VersionEntry = versionList.find(entry => entry.apihost === apihost && entry.namespace === namespace)
  if (!oldEntry) {
    debug('new entry pushed to version list')
    versionList.push(versionInfo)
  } else {
    debug('merging new entry into old')
    mergeVersions(oldEntry, versionInfo, replace)
  }
  fs.writeFileSync(versionFile, JSON.stringify(versionList, null, 2))
  debug('wrote version info to %s', versionFile)
  return created ? statusDir : ''
}

// Merge new information into old information within the version store.
// If replace is specified, each major element of the old entry (packageVersions, actionVersions, webHashes) is replaced
// with the new.  Otherwise, the dictionaries are merged.
function mergeVersions(oldEntry: VersionEntry, newEntry: VersionEntry, replace: boolean) {
  if (replace) {
    Object.assign(oldEntry, newEntry)
  } else {
    Object.assign(oldEntry.actionVersions, newEntry.actionVersions)
    Object.assign(oldEntry.packageVersions, newEntry.packageVersions)
    Object.assign(oldEntry.webHashes, newEntry.webHashes)
  }
}

// Load the version information of a project for a namespace and apihost.  Return an appropriately empty structure if not found.
export function loadVersions(projectPath: string, namespace: string, apihost: string): VersionEntry {
  const versionFile = path.join(projectPath, '.deployed', 'versions.json')
  if (fs.existsSync(versionFile)) {
    const allEntries = JSON.parse(String(fs.readFileSync(versionFile)))
    for (const entry of allEntries) {
      if (namespace === entry.namespace && apihost === entry.apihost) {
        return entry
      }
    }
  }
  return { namespace, apihost, packageVersions: {}, actionVersions: {}, webHashes: {} }
}

// Introduce small delay
export function delay(millis: number): Promise<void> {
  return new Promise(function (resolve) {
    setTimeout(() => resolve(), millis)
  })
}

// Await the completion of an action invoke.  The poll interval is fixed at 1 second.
// The 'waiting' argument is called every 10 polls (intended for providing progress feedback).
// The total wait time should be expressed in #polls.  Because of imprecision in the time
// management this will generally be longer than #seconds but not by a huge factor.
// If the wait "times out", undefined is returned.
export async function waitForActivation(id: string, wsk: Client, waiting: () => void, total: number): Promise<Activation<Dict>> {
  debug(`waiting for activation with id ${id}`)
  for (let i = 1 ;i <= total; i++) {
    try {
      const activation = await wsk.activations.get(id)
      if (activation.end || activation.response.status) {
        debug('activation %s found after %d iterations', id, i)
        return activation
      }
    } catch (err) {
      if (err.statusCode !== 404) {
        throw err
      }
    }
    if (i % 10 === 0) {
      waiting()
    }
    await delay(1000)
  }
  return undefined
}

// Higher level wrapper around wskRequest for web-secure actions.  Forms the URL
export function invokeWebSecure(actionAndQuery: string, auth: string, apihost: string): Promise<any> {
  let url = apihost + '/api/v1/web' + actionAndQuery
  return wskRequest(url, auth) 
}

// Subroutine to invoke OW with a GET and return the response.  Bypasses the OW client.  Used
// to invoke web actions, with or without auth needed.
export function wskRequest(url: string, auth: string = undefined): Promise<any> {
  debug('Request to: %s', url)
  return new Promise(function (resolve, reject) {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', url)
    const userAgent = getUserAgent()
    xhr.setRequestHeader('User-Agent', userAgent)
    xhr.onload = function () {
      if (this.status >= 200 && this.status < 300) {
        debug('useful response')
        resolve(JSON.parse(xhr.responseText))
      } else {
        debug('Error from OW %s %s', xhr.status, xhr.responseText)
        reject(new Error(xhr.responseText))
      }
    }
    xhr.onerror = function () {
      debug('network error')
      reject(new Error('Network error'))
    }
    if (auth) {
      if (auth.includes(':')) {
        debug('Setting basic authorization header')
        xhr.setRequestHeader('Authorization', 'Basic ' + Buffer.from(auth).toString('base64'))
      } else {
        debug('Setting X-Require-Whisk-Auth header to %s', auth)
        xhr.setRequestHeader('X-Require-Whisk-Auth', auth)
      }
    }
    xhr.send()
  })
}

// Utility to rename a package in a DeployStructure in a safe and consistent way.
// Will throw if the oldName does not match a package in the spec.
export function renamePackage(spec: DeployStructure, oldName: string, newName: string): DeployStructure {
  const pkg = spec.packages?.find(pkg => pkg.name === oldName)
  if (!pkg) {
    throw new Error(`Package '${oldName}' was not found in the DeployStructure`)
  }
  pkg.name = newName
  if (pkg.actions) {
    for (const action of pkg.actions) {
      action.package = newName
    }
  }
  return spec
}

// Checks if a given pattern matches exclusion list, defined by system or user via global .exclude file.
export function isExcluded(match: string): boolean {
  return anymatch(getExclusionList(), match)
}

// Returns full list of exclusion patterns, predefined or listed in the global .exclude file.
export function getExclusionList(): string[] {
  let userDefinedPatterns = []
  try {
    const globalExcludeFile = path.join(nimbellaDir(), '.exclude')
    userDefinedPatterns = fs.readFileSync(globalExcludeFile).toString().split('\n').filter(e => e.toString().trim() !== '')
  } catch (e) {
    debug(e.message)
  }
  const allPatterns = [...userDefinedPatterns, ...SYSTEM_EXCLUDE_PATTERNS]
  return allPatterns
}
