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

// Contains the main public (library) API of the deployer (some exports in 'util' may also be used externally but are incidental)

import { cleanOrLoadVersions, doDeploy, cleanPackage } from './deploy'
import { DeployStructure, DeployResponse, PackageSpec, OWOptions, Credentials, Flags, Includer, Feedback, DefaultFeedback } from './deploy-struct'
import { readTopLevel, buildStructureParts, assembleInitialStructure } from './project-reader'
import {
  isTargetNamespaceValid, wrapError, wipe, saveUsFromOurselves, writeProjectStatus, getTargetNamespace,
  checkBuildingRequirements, errorStructure, getBestProjectName, inBrowser, isRealBuild
} from './util'
import { buildAllActions, maybeBuildLib } from './finder-builder'
import openwhisk = require('openwhisk')
import { getCredentialsForNamespace, getCredentials, Persister, recordNamespaceOwnership } from './credentials'
import { makeIncluder } from './includer'
import makeDebug from 'debug'
import { RuntimesConfig } from './runtimes'
const debug = makeDebug('nim:deployer:api')

// Initialize the API by 1. purging existing __OW_ entries from the environment, 2.  setting __OW_USER_AGENT, 3. returning a map of
// entries that were purged.   Also saves the __OW_NAMESPACE and __OW_API_HOST values in the environment, renamed, for the special
// cases where there is no credential store but certain code paths still must work.  An example is the slice reader.
export function initializeAPI(userAgent: string): {[key: string]: string} {
  const result: Record<string, string> = {}
  for (const item in process.env) {
    if (item.startsWith('__OW_')) {
      result[item] = process.env[item]
      delete process.env[item]
    }
  }
  process.env.__OW_USER_AGENT = userAgent
  // Careful with these transfers.  Assigning a value to the env always casts to string (even undefined -> "undefined")
  if (result.__OW_NAMESPACE) {
    process.env.savedOW_NAMESPACE = result.__OW_NAMESPACE
  }
  if (result.__OW_API_HOST) {
    process.env.savedOW_API_HOST = result.__OW_API_HOST
  }
  if (result.__OW_API_KEY) {
    process.env.savedOW_API_KEY = result.__OW_API_KEY
  }
  return result
}

// Get a vaguely valid user agent string.  Hopefully, this was set in the environment during initialize.  But, we use some fallbacks if not.
// It is not necessary to call this function when using the OW client because it will respect __OW_USER_AGENT directly.  It is used
// when using other web APIs in order to set a valid and possibly useful value in the user-agent header.
export function getUserAgent(): string {
  const ans = process.env.__OW_USER_AGENT
  return ans || (inBrowser ? 'nimbella-workbench' : 'nimbella-cli')
}

// Deploy a disk-resident project given its path and options to pass to openwhisk.  The options are merged
// with those in the config; the result must include api or apihost, and must include api_key.
export async function deployProject(path: string, owOptions: OWOptions, credentials: Credentials|undefined, persister: Persister, flags: Flags, runtimes: RuntimesConfig): Promise<DeployResponse> {
  debug('deployProject invoked with incremental %s', flags.incremental)
  return readPrepareAndBuild(path, owOptions, credentials, persister, flags, runtimes).then(spec => {
    if (spec.error) {
      debug('An error was caught prior to %O:', spec.error)
      return Promise.resolve(wrapError(spec.error, undefined))
    }
    return deploy(spec)
  })
}

// Combines the read, prepare, and build phases but does not deploy
export function readPrepareAndBuild(path: string, owOptions: OWOptions, credentials: Credentials, persister: Persister,
  flags: Flags, runtimes: RuntimesConfig, userAgent?: string, feedback?: Feedback): Promise<DeployStructure> {
  return readAndPrepare(path, owOptions, credentials, persister, flags, runtimes, undefined, feedback).then(spec => spec.error ? spec
    : buildProject(spec, runtimes))
}

// Combines the read and prepare phases but does not build or deploy
export function readAndPrepare(path: string, owOptions: OWOptions, credentials: Credentials, persister: Persister,
  flags: Flags, runtimes: RuntimesConfig, userAgent?: string, feedback?: Feedback): Promise<DeployStructure> {
  const includer = makeIncluder(flags.include, flags.exclude)
  return readProject(path, flags.env, flags.buildEnv, includer, flags.remoteBuild, feedback, runtimes).then(spec => spec.error ? spec
    : prepareToDeploy(spec, owOptions, credentials, persister, flags))
}

// Perform deployment from a deploy structure.  The 'cleanOrLoadVersions' step is currently folded into this step
export function deploy(todeploy: DeployStructure): Promise<DeployResponse> {
  debug('Starting deploy')
  return cleanOrLoadVersions(todeploy).then(doDeploy).then(results => {
    if (!todeploy.githubPath) {
      const statusDir = writeProjectStatus(todeploy.filePath, results, todeploy.includer.isIncludingEverything())
      if (statusDir && !todeploy.slice) {
        todeploy.feedback.progress(`Deployment status recorded in '${statusDir}'`)
      }
    }
    if (!results.namespace && todeploy.credentials) {
      results.namespace = todeploy.credentials.namespace
    }
    return results
  })
}

// Read the information contained in the project, initializing the DeployStructure
export async function readProject(projectPath: string, envPath: string, buildEnvPath: string, includer: Includer, requestRemote: boolean,
  feedback: Feedback = new DefaultFeedback(), runtimes: RuntimesConfig): Promise<DeployStructure> {
  debug('Starting readProject, projectPath=%s, envPath=%s', projectPath, envPath)
  let ans: DeployStructure
  try {
    const topLevel = await readTopLevel(projectPath, envPath, buildEnvPath, includer, false, feedback)
    const parts = await buildStructureParts(topLevel, runtimes)
    ans = assembleInitialStructure(parts)
  } catch (err) {
    return errorStructure(err)
  }
  if (ans.error) {
    // Remaining steps are treacherous if there was an error detected in the config. We don't use the
    // errorStructure return for that case, because we need to support get-metadata, which wants a config
    // even if erroneous.  However, any other uses are going to fail.
    return ans
  }
  debug('evaluating the just-read project: %O', ans)
  let needsLocalBuilds: boolean
  try {
    needsLocalBuilds = await checkBuildingRequirements(ans, requestRemote, runtimes)
    debug('needsLocalBuilds=%s', needsLocalBuilds)
  } catch (err) {
    return errorStructure(err)
  }
  if (needsLocalBuilds && ans.reader.getFSLocation() === null) {
    debug("project '%s' will be re-read and cached because it's a github project that needs local building", projectPath)
    if (inBrowser) {
      return errorStructure(new Error(`Project '${projectPath}' cannot be deployed from the cloud because it requires building`))
    }
    try {
      const topLevel = await readTopLevel(projectPath, envPath, buildEnvPath, includer, true, feedback)
      const parts = await buildStructureParts(topLevel, runtimes)
      ans = assembleInitialStructure(parts)
    } catch (err) {
      return errorStructure(err)
    }
  }
  return ans
}

// 'Build' the project by running the "finder builder" steps in
// 1.  the 'lib' directory if found and if building it is appropriate
// 2.  each action-as-directory
// 3.  the 'web' directory if found
// Steps 2 and 3 can be done in parallel but step 1 must complete before the
// others are started.
export async function buildProject(project: DeployStructure, runtimes: RuntimesConfig): Promise<DeployStructure> {
  debug('Starting buildProject with spec %O', project)
  if (project.libBuild && isRealBuild(project.libBuild)) {
    try {
      await maybeBuildLib(project)
    } catch (err) {
      return errorStructure(err)
    }
  }
  const actionPromise: Promise<PackageSpec[]> = buildAllActions(project, runtimes)
  if (actionPromise) {
    return actionPromise.then(packages => {
      project.packages = packages
      return project
    }).catch(err => errorStructure(err))
  } else {
    return Promise.resolve(project)
  }
}

// Prepare a DeployStruct for deployment.
// 1.  Ensure that we are using the right credentials
// 2.  Merge credentials and user-specified OWOptions that were not necessarily part of the credentials.
// 3.  Open the OW client handle to ensure it is valid before the (possibly extensive) build step is performed.
//   Validation includes the optional check on the target namespace; even if it came from the credentials it might no longer be valid.
export async function prepareToDeploy(inputSpec: DeployStructure, owOptions: OWOptions, credentials: Credentials, persister: Persister,
  flags: Flags): Promise<DeployStructure> {
  debug('Starting prepare with spec: %O', inputSpec)
  // 0. Handle slice.  In that case, credentials and flags come from the DeployStructure
  if (inputSpec.slice) {
    debug('Retrieving credentials and flags from spec for slice')
    credentials = inputSpec.credentials
    // The API host in the slice spec may represent a proxy and hence not be the real intended host.
    // If __OW_API_HOST is set, it is more trustworthy.
    if (process.env.__OW_API_HOST) {
      credentials.ow.apihost = process.env.__OW_API_HOST
    } else if (process.env.savedOW_API_HOST) {
      credentials.ow.apihost = process.env.savedOW_API_HOST
    }
    flags = inputSpec.flags
  }
  // 1.  Acquire credentials if not already present
  let isTest = false
  let isProduction = false
  if (!credentials) {
    debug('Finding credentials locally')
    let namespace: string
    if (typeof inputSpec.targetNamespace === 'string') {
      namespace = inputSpec.targetNamespace
    } else if (inputSpec.targetNamespace) {
      const { test, production } = inputSpec.targetNamespace // previously validated
      if (flags.production) {
        if (production) {
          namespace = production
          isProduction = true
        } else {
          return errorStructure(new Error('The production flag was specified but there is no production namespace'))
        }
      } else {
        if (test) {
          namespace = test
          isTest = true
        } else {
          return errorStructure(new Error('The production flag was not specified and there is no test namespace'))
        }
      }
    }
    if (namespace) {
      // The config specified a target namespace so attempt to use it.
      debug('Retrieving specific credentials for namespace %s', namespace)
      credentials = await getCredentialsForNamespace(namespace, owOptions.apihost, persister)
    } else {
      // There is no target namespace so get credentials for the current one
      let badCredentials: Error
      debug('Attempting to get credentials for current namespace')
      credentials = await getCredentials(persister).catch(err => {
        badCredentials = err
        return undefined
      })
      if (badCredentials) {
        debug('Could not get credentials, returning error structure with %O', badCredentials)
        return errorStructure(badCredentials)
      }
    }
  }
  debug('owOptions: %O', owOptions)
  debug('credentials.ow: %O', credentials.ow)
  // We have valid credentials but now we must check that we are allowed to deploy to the namespace according to the ownership rules.
  if (credentials.project) {
    const apparentProject = getBestProjectName(inputSpec)
    if (credentials.project !== apparentProject) {
      return errorStructure(new Error(`Deployment to namespace '${credentials.namespace}' must be from project '${credentials.project}'`))
    }
    if (isTest && credentials.production) {
      return errorStructure(new Error(
        `Namespace '${credentials.namespace}' is a production namespace but 'project.yml' declares it as a test namespace`))
    }
    if (isProduction && !credentials.production) {
      return errorStructure(new Error(
        `Namespace '${credentials.namespace}' is a test namespace but 'project.yml' declares it as a production namespace`))
    }
  }
  // Record ownership if it is declared.  At this point we know it is legal and non-conflicting.
  if (isTest || isProduction) {
    recordNamespaceOwnership(getBestProjectName(inputSpec), credentials.namespace, credentials.ow.apihost, isProduction, persister)
  }
  // Merge and save credentials information
  const wskoptions = Object.assign({}, credentials.ow, owOptions || {})
  debug('wskoptions" %O', wskoptions)
  inputSpec.credentials = credentials
  debug('prepareToDeploy merging flags: %O', flags)
  inputSpec.flags = flags
  debug('Options merged')
  // 3.  Open handles
  debug('Auth sufficiency established')
  inputSpec.owClient = openwhisk(wskoptions)
  if (!credentials.namespace) {
    credentials.namespace = await getTargetNamespace(inputSpec.owClient)
  } else {
    await isTargetNamespaceValid(inputSpec.owClient, credentials.namespace)
  }
  debug('Target namespace validated')
  if (!flags.production && saveUsFromOurselves(credentials.namespace, credentials.ow.apihost)) {
    return errorStructure(new Error(
      `To deploy to namespace '${credentials.namespace}' on host '${credentials.ow.apihost}' you must specify the '--production' flag`))
  }
  debug('Sensitive project/namespace guard passed')
  debug('returning spec %O', inputSpec)
  return Promise.resolve(inputSpec)
}

// Utility to convert errors into useful messages.   Usually, this just means getting the message field from the error but there
// is logic to recognize the particular error pattern used by OW
export function getMessageFromError(err: any): string {
  // Although we attempt to say that all errors have type Error, in the loosy-goosy untyped world of Javascript this is easily violated.
  // Sometimes 'err' is just a string
  if (typeof err === 'string') {
    return err
  }
  // Pattern match against the OW error pattern
  if (err.error && err.error.error && err.error.code) {
    return '[OpenWhisk] ' + err.error.error
  }
  // Default case
  return err.message
}

// Wipe a namespace of everything except its activations (the activations cannot be wiped via the public API)
export async function wipeNamespace(host: string, auth: string): Promise<void> {
  debug('Requested wipe-namespace function with host %s and auth %s', host, auth)
  const init: OWOptions = { apihost: host, api_key: auth }
  const client = openwhisk(init)
  debug('Client opened')
  return wipe(client)
}

// Completely remove a package including its contained actions
export async function wipePackage(name: string, host: string, auth: string): Promise<openwhisk.Package> {
  debug("wipePackage invoked with name='%s', host='%s', auth='%s", name, host, auth)
  const init: OWOptions = { apihost: host, api_key: auth }
  const client = openwhisk(init)
  return cleanPackage(client, name, undefined)
}
