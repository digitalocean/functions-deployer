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

import { readAndPrepare, buildProject, deploy } from './api'
import { Flags, OWOptions, DeployResponse, Credentials, Feedback, DefaultFeedback } from './deploy-struct'
import { isGithubRef } from './github'
import { getGithubAuth } from './credentials'
import { deleteSlice } from './slice-reader'
import * as path from 'path'
import { default as parser } from 'yargs-parser'

// Provides a limited purpose main function for the deployer
//main().then(flush).catch(handleError)

// The Logger type is adopted from the nim CLI
interface Logger {
  log: (msg: string, ...args: any[]) => void
  handleError: (msg: string, err?: Error) => never
  exit: (code: number) => void // don't use 'never' here because 'exit' doesn't always exit
  displayError: (msg: string, err?: Error) => void
  logJSON: (entity: any) => void
  logTable: (data: Record<string, unknown>[], columns: Record<string, unknown>, options: Record<string, unknown>) => void
  logOutput: (json: any, msgs: string[]) => void
}

// The default logger implementation
class DefaultLogger implements Logger {
  log(msg = '', ...args: any[]): void {
    console.log(msg, ...args)
  }
  
  handleError(msg: string, err?: Error): never {
    if (err) throw err
    throw new Error(msg)
  }

  displayError(msg: string, err?: Error): void {
    if (!err) {
       err = new Error(msg || 'unknown error')
    }
    console.error(err)
  }

  exit(code: number): void {
    process.exit(code)
  }

  logJSON(entity: Record<string, unknown>): void {
    console.log(entity)
  }

  logTable(data: Record<string, unknown>[], columns: Record<string, unknown>, options: Record<string, unknown> = {}): void {
    console.log(data)
  }

  logOutput(json: Record<string, unknown>, msgs: string[]): void {
    for (const msg of msgs) {
      console.log(msg)
    }
    console.log(json)
  }
}

// An alternative Logger for capturing output
export class CaptureLogger implements Logger {
  command: string[] // The oclif command sequence being captured (aio only)
  table: Record<string, unknown>[] // The output table (array of entity) if that kind of output was produced
  tableColumns: Record<string, unknown> // The column definition needed to format the table with cli-ux
  tableOptions: Record<string, unknown> // The options definition needed to format the table with cli-ux
  captured: string[] = [] // Captured line by line output (flowing via Logger.log)
  errors: string[] = [] // Captured calls to displayError (these are Errors that are not supposed to be thrown)
  entity: Record<string, unknown> // An output entity if that kind of output was produced

  log(msg = '', ...args: any[]): void {
    const msgs = String(msg).split('\n')
    for (const msg of msgs) {
      this.captured.push(msg, ...args)
    }
  }

  handleError(msg: string, err?: Error): never {
    if (err) throw err
    throw new Error(msg)
  }

  displayError(msg: string, err?: Error): void {
    if (err && !msg) {
       msg = err.message
    }
    this.errors.push(msg || 'unknown error')
  }

  exit(_code: number): void {
    // a no-op here
  }

  logJSON(entity: Record<string, unknown>): void {
    this.entity = entity
  }

  logTable(data: Record<string, unknown>[], columns: Record<string, unknown>, options: Record<string, unknown> = {}): void {
    this.table = data
    this.tableColumns = columns
    this.tableOptions = options
  }

  logOutput(json: Record<string, unknown>, msgs: string[]): void {
    this.entity = json
    this.captured = msgs
  }
}

// Wrap a Logger in a Feedback for using the deployer API.
export class LoggerFeedback implements Feedback {
  logger: Logger
  warnOnly: boolean
  constructor(logger: Logger) {
    this.logger = logger
  }

  warn(msg?: any, ...args: any[]): void {
    this.logger.log(String(msg), ...args)
  }

  progress(msg?: any, ...args: any[]): void {
    if (this.warnOnly) return
    this.logger.log(String(msg), ...args)
  }
}

// Ensure that console output is flushed when the command is really finished
// Note: this logic is adopted from oclif's cli-ux flush function.
export async function flush() {
    function timeout(p, ms) {
        function wait(ms, unref = false) {
            return new Promise(resolve => {
                const t = setTimeout(() => resolve(undefined), ms);
                if (unref)
                   t.unref();
            });
        }
        return Promise.race([p, wait(ms, true).then(() => exports.ux.error('timed out'))]);
    }
    async function flush() {
        const p = new Promise(resolve => process.stdout.once('drain', () => resolve(undefined)));
         process.stdout.write('');
         return p;
    }
    await timeout(flush(), 10000);
}

// Deal with errors thrown from within the deployer
export function handleError(err: any) {
    let msg = err.message
    if (!msg && 'string' === typeof err) {
      msg = err
    }
    console.log(JSON.stringify({ error: msg || 'Unknown error' }, null, 2))
    process.exit(1)
}

// Parsing template: declares the flags
const parsing = {
  string: ['env', 'build-env', 'apihost', 'auth', 'include', 'exclude' ],
  boolean: ['insecure', 'verbose-build', 'verbose-zip', 'yarn', 'remote-build', 'incremental', 'json'],
  configuration: {
    'parse-positional-numbers': false,
    'unknown-options-as-args': true
  }
}

// Main function.  Covers what used to be in the 'nim project' tree and that continues to be needed in DigitalOcean
export async function main() {
  const logger = new DefaultLogger()
  const parsed = parser(process.argv.slice(2), parsing)
  const args = parsed._ as string[]
  const badFlags = args.filter(arg => arg.startsWith('-'))
  if (badFlags.length > 0) {
    logger.handleError(`unknown flag(s): [${badFlags}]`)
  }
  if (args.length != 2) {
    logger.handleError('exactly two non-flag tokens are required: the command, and the project')
  }
  const [ cmd, project ] = args
  const { env, buildEnv, apihost, auth, include, exclude, insecure, verboseBuild, verboseZip, yarn, remoteBuild, incremental, json } = parsed
  const flags: Flags = { env, buildEnv, apiHost: apihost, auth, include, exclude, insecure, verboseBuild, verboseZip, yarn, remoteBuild, incremental, json }
  switch (cmd) {
    case 'deploy':
      await doDeploy(project, flags, logger)
      break
    case 'get-metadata':
      await doGetMetadata(project, flags, logger)
      break
    case 'watch':
      await doWatch(project, flags, logger)
      break
    default:
      logger.handleError(`unknown command: ${cmd}`)
  }
}

// Command to do deployment
async function doDeploy(project: string, flags: Flags, logger: Logger): Promise<void> {
    const isGithub = isGithubRef(project)
    if (flags.incremental && isGithub) {
      logger.handleError('\'--incremental\' may not be used with GitHub projects')
    }
    if (isGithub && !getGithubAuth()) {
      logger.handleError(`you don't have GitHub authorization.  Deploy from github not enabled.`)
    }
    this.debug('cmdFlags', flags)
    const { insecure, apiHost: apihost, auth } = flags
    const creds = await processCredentials(insecure, apihost, auth)
    this.debug('creds', creds)

    if (!await deployProject(project, flags, creds, false, logger)) {
      process.exit(1)
    }
}

async function doGetMetadata(project: string, flags: Flags, logger: Logger): Promise<void> {

}

async function doWatch(project: string, flags: Flags, logger: Logger): Promise<void> {

}

// Set up credentials based on flags if supplied.  Otherwise, credentials will be undefined until later, either based on
// targetNamespace in the project.yml or else just the current connected namespace.
export async function processCredentials(ignore_certs: boolean, apihost: string|undefined, auth: string|undefined): Promise<Credentials> {
  const owOptions: OWOptions = { ignore_certs } // No explicit undefined
  if (apihost) {
    owOptions.apihost = parseAPIHost(apihost)
  }
  if (auth) {
    owOptions.api_key = auth
  }
  let creds: Credentials|undefined
  if (apihost && auth) {
    creds = { namespace: undefined, ow: owOptions }
  }
  return creds
}

// Utility to parse the value of an --apihost flag, permitting certain abbreviations
export function parseAPIHost(host: string | undefined): string | undefined {
  if (!host) {
    return undefined
  }
  if (host.includes(':')) {
    return host
  }
  if (host.includes('.')) {
    return 'https://' + host
  }
  return 'https://' + host + '.doserverless.co'
}

// Deploy one project
export async function deployProject(project: string, cmdFlags: Flags, creds: Credentials|undefined, watching: boolean, logger: Logger): Promise<boolean> {
  let feedback: LoggerFeedback
  if (project.startsWith('slice:') || cmdFlags.json) {
    feedback = new LoggerFeedback(new CaptureLogger())
    feedback.warnOnly = true
  } else {
    feedback = new LoggerFeedback(new DefaultLogger())
  }

  let todeploy = await readAndPrepare(project, creds, cmdFlags, feedback)
  if (!todeploy) {
    return false
  } else if (todeploy.error && !cmdFlags.json) {
    console.error(todeploy.error)
    return false
  }
  if (!watching && !todeploy.slice && !cmdFlags.json) {
    displayHeader(project, todeploy.credentials, logger)
  }
  todeploy = await buildProject(todeploy)
  if (todeploy.error && !cmdFlags.json) {
    logger.displayError('', todeploy.error)
    return false
  }
  const result: DeployResponse = await deploy(todeploy)
  if (cmdFlags.json || todeploy.slice) {
    const success = displayJSONResult(result, logger, feedback, todeploy.slice)
    if (success && todeploy.slice) {
      await deleteSlice(todeploy)
    }
    return success
  }
  return displayResult(result, watching, logger)
}

// Display the deployment "header" (what we are about to deploy)
function displayHeader(project: string, creds: Credentials, logger: Logger) {
  let namespaceClause = ''
  if (creds && creds.namespace) {
    namespaceClause = `\n  to namespace '${creds.namespace}'`
  }
  let hostClause = ''
  if (creds && creds.ow.apihost) {
    hostClause = `\n  on host '${creds.ow.apihost}'`
  }
  const projectPath = isGithubRef(project) ? project : path.resolve(project)
  logger.log(`Deploying '${projectPath}'${namespaceClause}${hostClause}`)
}

// Display the result of a successful run when deploying a slice or when JSON is requested.
// The output should be the DeployResponse as JSON on a single line, combined with the Feedback transcript if any
function displayJSONResult(outcome: DeployResponse, logger: Logger, feedback: any, slice: boolean): boolean {
  const transcript = feedback.logger.captured
  const result = { transcript, outcome }
  if (slice) {
    // Not using logJSON here because we need single-line output.
    // This is executing in a builder action anyway ... doesn't matter how output is produced.
    function replaceErrors(_key: string, value: any): any {
      if (value instanceof Error) {
        const error = {}
        Object.getOwnPropertyNames(value).forEach(function(key) {
          error[key] = value[key]
        })
        return error
      }
      return value
    }
    const toDisplay = JSON.stringify(result, replaceErrors)
    logger.log(toDisplay)
  } else {
    // Normal JSON, print normally with indentation
    logger.logJSON(result)
  }
  return outcome.failures.length === 0
}

// Display the result of a successful run
function displayResult(result: DeployResponse, watching: boolean, logger: Logger): boolean {
  let success = true
  if (result.successes.length === 0 && result.failures.length === 0) {
    logger.log('\nNothing deployed')
  } else {
    logger.log('')
    const actions: string[] = []
    const triggers: string[] = []
    let skippedActions = 0
    let skippedTriggers = 0
    for (const success of result.successes) {
      if (success.kind === 'action') {
        if (success.skipped) {
          skippedActions++
        } else {
          let name = success.name
          actions.push(name)
        }
      } else if (success.kind === 'trigger') {
        if (success.skipped) {
          skippedTriggers++
        } else {
          triggers.push(success.name)
        }
      }
    }
    if (actions.length > 0) {
      logger.log("Deployed functions ('doctl sbx fn get <funcName> --url' for URL):")
      for (const action of actions) {
        logger.log(`  - ${action}`)
      }
    }
    if (skippedActions > 0) {
      logger.log(`Skipped ${skippedActions} unchanged functions`)
    }
    if (triggers.length > 0) {
      logger.log('Deployed triggers:')
      for (const trigger of triggers) {
        logger.log(`  - ${trigger}`)
      }
    }
    if (skippedTriggers > 0) {
      logger.log(`Skipped ${skippedTriggers} triggers`)
    }
    if (result.failures.length > 0) {
      success = false
      logger.log('Failures:')
      for (const err of result.failures) {
        success = false
        const context = (err as any).context
        if (context) {
          logger.displayError(`While deploying ${context}`, err)
        } else {
          logger.displayError('', err)
        }
      }
    }
  }
  return success
}
