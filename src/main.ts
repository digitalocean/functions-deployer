/*
 * Copyright (c) 2019 - present DigitalOcean, LLC
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

import { readAndPrepare, readProject, buildProject, deploy } from './api';
import {
  Flags,
  OWOptions,
  DeployResponse,
  Credentials,
  Feedback
} from './deploy-struct';
import { deleteSlice } from './slice-reader';
import { makeIncluder } from './includer';
import { getRuntimeForAction, renameActionsToFunctions } from './util';
import { watch } from './watch';
import * as path from 'path';
import { default as parser } from 'yargs-parser';
import { STATUS_CODES } from 'http';
import createDebug from 'debug';
import { version } from './version';
const verboseError = createDebug('nim:error');

// Provides a limited purpose main function for the deployer
//main().then(flush).catch(handleError)

// Also provides a library entry point (runCommand) which abstracts the output
// of the main function so it can be captured.

// The Logger type is adopted from the nim CLI
export interface Logger {
  log: (msg: string, ...args: any[]) => void;
  handleError: (msg: string, err?: Error) => never;
  exit: (code: number) => void; // don't use 'never' here because 'exit' doesn't always exit
  displayError: (msg: string, err?: Error) => void;
  logJSON: (entity: any) => void;
  logTable: (
    data: Record<string, unknown>[],
    columns: Record<string, unknown>,
    options: Record<string, unknown>
  ) => void;
  logOutput: (json: any, msgs: string[]) => void;
}

// The default logger implementation
export class DefaultLogger implements Logger {
  log(msg = '', ...args: any[]): void {
    console.log(msg, ...args);
  }

  handleError(msg: string, err?: Error): never {
    if (err) throw err;
    msg = improveErrorMsg(msg, err);
    throw new Error(msg);
  }

  displayError(msg: string, err?: Error): void {
    msg = improveErrorMsg(msg, err);
    verboseError('%O', err);
    const bang = process.platform === 'win32' ? '»' : '›';
    console.error(bang + '   Error: ' + msg);
  }

  exit(code: number): void {
    process.exit(code);
  }

  logJSON(entity: Record<string, unknown>): void {
    console.log(JSON.stringify(entity, null, 2));
  }

  logTable(
    data: Record<string, unknown>[],
    _columns: Record<string, unknown>,
    _options: Record<string, unknown> = {}
  ): void {
    console.log(JSON.stringify(data, null, 2));
  }

  logOutput(json: Record<string, unknown>, msgs: string[]): void {
    for (const msg of msgs) {
      console.log(msg);
    }
    console.log(JSON.stringify(json, null, 2));
  }
}

// An alternative Logger for capturing output
export class CaptureLogger implements Logger {
  table: Record<string, unknown>[]; // The output table (array of entity) if that kind of output was produced
  captured: string[] = []; // Captured line by line output (flowing via Logger.log)
  errors: string[] = []; // Captured calls to displayError (these are Errors that are not supposed to be thrown)
  entity: Record<string, unknown>; // An output entity if that kind of output was produced

  log(msg = '', ...args: any[]): void {
    const msgs = String(msg).split('\n');
    for (const msg of msgs) {
      this.captured.push(msg, ...args);
    }
  }

  handleError(msg: string, err?: Error): never {
    if (err) throw err;
    msg = improveErrorMsg(msg, err);
    throw new Error(msg);
  }

  displayError(msg: string, err?: Error): void {
    msg = improveErrorMsg(msg, err);
    this.errors.push(msg);
  }

  exit(_code: number): void {
    // a no-op here
  }

  logJSON(entity: Record<string, unknown>): void {
    this.entity = entity;
  }

  logTable(
    data: Record<string, unknown>[],
    _columns: Record<string, unknown>,
    _options: Record<string, unknown> = {}
  ): void {
    this.table = data;
  }

  logOutput(json: Record<string, unknown>, msgs: string[]): void {
    this.entity = json;
    this.captured = msgs;
  }
}

// Wrap a Logger in a Feedback for using the deployer API.
class LoggerFeedback implements Feedback {
  logger: Logger;
  warnOnly: boolean;
  constructor(logger: Logger) {
    this.logger = logger;
  }

  warn(msg?: any, ...args: any[]): void {
    this.logger.log(String(msg), ...args);
  }

  progress(msg?: any, ...args: any[]): void {
    if (this.warnOnly) return;
    this.logger.log(String(msg), ...args);
  }
}

// Ensure that console output is flushed when the command is really finished
export async function flush() {
  process.stdout.once('drain', () => process.exit(0));
}

// Deal with errors thrown from within the deployer
export function handleError(err: any) {
  console.error(err);
  process.exit(1);
}

// Parsing template: declares the flags
const parsing = {
  string: ['env', 'build-env', 'apihost', 'auth', 'include', 'exclude'],
  boolean: [
    'insecure',
    'verbose-build',
    'verbose-zip',
    'yarn',
    'remote-build',
    'incremental',
    'json',
    'no-triggers'
  ],
  configuration: {
    'parse-positional-numbers': false,
    'unknown-options-as-args': true,
    'boolean-negation': false
  }
};

// Main function.  The thinnest possible shell around 'runCommand' which is a library-level entry
// point suitable for use by a reduced doctl plugin.  The only thing added here is the default logger,
// which simply causes output to go directly to the console.
export function main(): Promise<void> {
  return runCommand(process.argv.slice(2), new DefaultLogger());
}

// Primary library entry point for running the commands with an arbitrary Logger
export async function runCommand(inputArgs: string[], logger: Logger) {
  const parsed = parser(inputArgs, parsing);
  const args = parsed._ as string[];
  const badFlags = args.filter((arg) => arg.startsWith('-'));
  if (badFlags.length > 0) {
    logger.handleError(`unknown flag(s): [${badFlags}]`);
  }
  if (args.length != 2 && args[0] !== 'version') {
    logger.handleError(
      'exactly two non-flag tokens are required: the command, and the project'
    );
  }
  const [cmd, project] = args;
  const {
    env,
    buildEnv,
    apihost,
    auth,
    include,
    exclude,
    insecure,
    verboseBuild,
    verboseZip,
    yarn,
    remoteBuild,
    incremental,
    json,
    noTriggers
  } = parsed;
  const flags: Flags = {
    env,
    buildEnv,
    apiHost: apihost,
    auth,
    include,
    exclude,
    insecure,
    verboseBuild,
    verboseZip,
    yarn,
    remoteBuild,
    incremental,
    json,
    noTriggers
  };
  switch (cmd) {
    case 'deploy':
      await doDeploy(project, flags, logger);
      break;
    case 'get-metadata':
      await doGetMetadata(project, flags, logger);
      break;
    case 'watch':
      // Note: it is up to the caller to use a non-capturing Logger with watch
      await doWatch(project, flags, logger);
      break;
    case 'version':
      logger.log(version);
      break;
    default:
      logger.handleError(`unknown command: ${cmd}`);
  }
}

// Command to do deployment
async function doDeploy(
  project: string,
  flags: Flags,
  logger: Logger
): Promise<void> {
  const { insecure, apiHost: apihost, auth } = flags;
  const creds = await processCredentials(insecure, apihost, auth);
  await deployProject(project, flags, creds, false, logger);
}

// Command to retrieve project description metadata
async function doGetMetadata(
  project: string,
  flags: Flags,
  logger: Logger
): Promise<void> {
  // Convert include/exclude flags into an Includer object
  const includer = makeIncluder(flags.include, flags.exclude);

  // Read the project
  const result = await readProject(
    project,
    flags.env,
    undefined,
    includer,
    false,
    undefined,
    flags.noTriggers
  );
  if (result.error && !result.unresolvedVariables) {
    logger.displayError('', result.error);
    logger.exit(1);
  }

  // Fill in any missing runtimes
  if (result.packages && !result.unresolvedVariables) {
    // Too dangerous to attempt this if the parse wasn't perfect
    for (const pkg of result.packages) {
      if (pkg.actions) {
        for (const action of pkg.actions) {
          action.runtime = await getRuntimeForAction(action, result.reader);
        }
      }
    }
  }

  // Display result
  renameActionsToFunctions(result);
  logger.logJSON(result);
}

// Command to do a project watch.
async function doWatch(
  project: string,
  flags: Flags,
  logger: Logger
): Promise<void> {
  const { insecure, apiHost: apihost, auth } = flags;
  const creds = await processCredentials(insecure, apihost, auth);
  watch(project, flags, creds, logger);
}

// Set up credentials based on flags if supplied.  Otherwise, credentials will be undefined until later, either based on
// targetNamespace in the project.yml or else just the current connected namespace.
async function processCredentials(
  ignore_certs: boolean,
  apihost: string | undefined,
  auth: string | undefined
): Promise<Credentials> {
  const owOptions: OWOptions = { ignore_certs }; // No explicit undefined
  if (apihost) {
    owOptions.apihost = parseAPIHost(apihost);
  }
  if (auth) {
    owOptions.api_key = auth;
  }
  let creds: Credentials | undefined;
  if (apihost && auth) {
    creds = {
      namespace: undefined,
      ow: owOptions,
      do_token: process.env.DO_API_TOKEN
    };
  }
  return creds;
}

// Utility to parse the value of an --apihost flag, permitting certain abbreviations
function parseAPIHost(host: string | undefined): string | undefined {
  if (!host) {
    return undefined;
  }
  if (host.includes(':')) {
    return host;
  }
  if (host.includes('.')) {
    return 'https://' + host;
  }
  return 'https://' + host + '.doserverless.co';
}

// Deploy one project
export async function deployProject(
  project: string,
  cmdFlags: Flags,
  creds: Credentials | undefined,
  watching: boolean,
  logger: Logger
): Promise<boolean> {
  let feedback: LoggerFeedback;
  if (project.startsWith('slice:') || cmdFlags.json) {
    feedback = new LoggerFeedback(new CaptureLogger());
    feedback.warnOnly = true;
  } else {
    feedback = new LoggerFeedback(logger);
  }

  let todeploy = await readAndPrepare(project, creds, cmdFlags, feedback);
  if (!todeploy) {
    return false;
  } else if (todeploy.error && !cmdFlags.json) {
    logger.displayError('', todeploy.error);
    return false;
  }
  if (!watching && !todeploy.slice && !cmdFlags.json) {
    displayHeader(project, todeploy.credentials, logger);
  }
  todeploy = await buildProject(todeploy);
  if (todeploy.error && !cmdFlags.json) {
    logger.displayError('', todeploy.error);
    return false;
  }
  const result: DeployResponse = await deploy(todeploy);
  if (cmdFlags.json || todeploy.slice) {
    const success = displayJSONResult(result, logger, feedback, todeploy.slice);
    if (success && todeploy.slice) {
      await deleteSlice(todeploy);
    }
    return success;
  }
  return displayResult(result, watching, logger);
}

// Display the deployment "header" (what we are about to deploy)
function displayHeader(project: string, creds: Credentials, logger: Logger) {
  let namespaceClause = '';
  if (creds && creds.namespace) {
    namespaceClause = `\n  to namespace '${creds.namespace}'`;
  }
  let hostClause = '';
  if (creds && creds.ow.apihost) {
    hostClause = `\n  on host '${creds.ow.apihost}'`;
  }
  const projectPath = path.resolve(project);
  logger.log(`Deploying '${projectPath}'${namespaceClause}${hostClause}`);
}

// Display the result of a successful run when deploying a slice or when JSON is requested.
// The output should be the DeployResponse as JSON on a single line, combined with the Feedback transcript if any
function displayJSONResult(
  outcome: DeployResponse,
  logger: Logger,
  feedback: any,
  slice: boolean
): boolean {
  const transcript = feedback.logger.captured;
  const result = { transcript, outcome };
  if (slice) {
    // Not using logJSON here because we need single-line output.
    // This is executing in a builder action anyway ... doesn't matter how output is produced.
    // eslint-disable-next-line no-inner-declarations
    function replaceErrors(_key: string, value: any): any {
      if (value instanceof Error) {
        const error = {};
        Object.getOwnPropertyNames(value).forEach(function (key) {
          error[key] = value[key];
        });
        return error;
      }
      return value;
    }
    const toDisplay = JSON.stringify(result, replaceErrors);
    logger.log(toDisplay);
  } else {
    // Normal JSON, print normally with indentation
    logger.logJSON(result);
  }
  return outcome.failures.length === 0;
}

// Display the result of a successful run
function displayResult(
  result: DeployResponse,
  _watching: boolean,
  logger: Logger
): boolean {
  let success = true;
  if (result.successes.length === 0 && result.failures.length === 0) {
    logger.log('\nNothing deployed');
  } else {
    logger.log('');
    const actions: string[] = [];
    const triggers: string[] = [];
    const packages: string[] = [];
    let skippedActions = 0;
    let skippedTriggers = 0;
    let skippedPackages = 0;
    for (const success of result.successes) {
      if (success.kind === 'action') {
        if (success.skipped) {
          skippedActions++;
        } else {
          const name = success.name;
          actions.push(name);
        }
      } else if (success.kind === 'trigger') {
        if (success.skipped) {
          skippedTriggers++;
        } else {
          triggers.push(success.name);
        }
      } else if (success.kind === 'binding') {
        if (success.skipped) {
          skippedPackages++;
        } else {
          packages.push(success.name);
        }
      }
    }
    if (actions.length > 0) {
      logger.log(
        "Deployed functions ('doctl sls fn get <funcName> --url' for URL):"
      );
      for (const action of actions) {
        logger.log(`  - ${action}`);
      }
    }
    if (skippedActions > 0) {
      logger.log(`Skipped ${skippedActions} unchanged functions`);
    }
    if (triggers.length > 0) {
      logger.log('Deployed triggers:');
      for (const trigger of triggers) {
        logger.log(`  - ${trigger}`);
      }
    }
    if (skippedTriggers > 0) {
      logger.log(`Skipped ${skippedTriggers} triggers`);
    }
    if (packages.length > 0) {
      logger.log('Deployed bound packages:');
      for (const pkg of packages) {
        logger.log(`  - ${pkg}`);
      }
    }
    if (skippedPackages > 0) {
      logger.log(`Skipped ${skippedPackages} bound packages`);
    }
    if (result.failures.length > 0) {
      success = false;
      logger.log('Failures:');
      for (const err of result.failures) {
        success = false;
        const context = (err as any).context;
        if (context) {
          logger.displayError(`While deploying ${context}`, err);
        } else {
          logger.displayError('', err);
        }
      }
    }
  }
  return success;
}

// Improves an error message based on analyzing the accompanying Error object (adopted from the nim CLI)
function improveErrorMsg(msg: string, err?: any): string {
  const getStatusCode = (code: number) =>
    `${code} ${STATUS_CODES[code] || ''}`.trim();

  let pretty = '';
  if (err) {
    pretty = err.message || '';
    if (err.name === 'OpenWhiskError') {
      if (err.error && err.error.error) {
        pretty = err.error.error.toLowerCase();
        if (err.statusCode)
          pretty = `${pretty} (${getStatusCode(err.statusCode)})`;
        else if (err.error.code) pretty = `${pretty} (${err.error.code})`;
      } else if (err.statusCode) {
        pretty = getStatusCode(err.statusCode);
      }
    }
  }
  if ((pretty || '').toString().trim()) {
    msg = msg ? `${msg}: ${pretty}` : pretty;
  }
  if (!msg) {
    if (err.status) {
      msg = getStatusCode(err.status);
    } else {
      msg = 'unknown error';
    }
  }
  return msg;
}
