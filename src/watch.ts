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

// This is the essence of the old watch command from Nimbella CLI.
// It should probably be replaced by go code or at least revised to use the best available
// file-watching techniques for the target OSs.

import * as fs from 'fs';
import * as chokidar from 'chokidar';
import { Flags, Credentials } from './deploy-struct';
import { Logger, deployProject } from './main';
import { isExcluded, delay } from './util';

// Validate a project and start watching it if it actually looks like a project
export function watch(
  project: string,
  cmdFlags: Flags,
  creds: Credentials | undefined,
  logger: Logger
) {
  logger.log(`Watching '${project}' [use Control-C to terminate]`);
  let watcher: chokidar.FSWatcher;
  const reset = async () => {
    if (watcher) {
      //logger.log("Closing watcher")
      await watcher.close();
    }
  };
  const watch = () => {
    //logger.log("Opening new watcher")
    watcher = chokidar.watch(project, {
      ignoreInitial: true,
      followSymlinks: false,
      usePolling: false,
      useFsEvents: false
    });
    watcher.on('all', async (event, filename) => {
      if (!isExcluded(filename)) {
        await fireDeploy(
          project,
          filename,
          cmdFlags,
          creds,
          logger,
          reset,
          watch,
          event
        );
      }
    });
  };
  watch();
}

// Fire a deploy cycle.  Suspends the watcher so that mods made to the project by the deployer won't cause a spurious re-trigger.
// TODO this logic was crafted for fs.watch().  There might be a better way to suspend chokidar.
// Displays an informative message before deploying.
async function fireDeploy(
  project: string,
  filename: string,
  cmdFlags: Flags,
  creds: Credentials | undefined,
  logger: Logger,
  reset: () => Promise<void>,
  watch: () => void,
  event: string
) {
  if (event === 'addDir') {
    // Don't fire on directory add ... it never represents a complete change.
    return;
  }
  if (event === 'add' && isSymlink(filename)) {
    // There may be a bug in chokidar ... we seem to get spurious add events for symlinks.
    // We strongly discourage symlinks within projects, so a new symlink is likely to be inside
    // a node_modules where we can ignore it.
    return;
  }
  await reset();
  logger.log(`\nDeploying '${project}' due to change in '${filename}'`);
  let error = false;
  const result = await deployProject(
    project,
    cmdFlags,
    creds,
    true,
    logger
  ).catch((err) => {
    logger.displayError('', err);
    error = true;
  });
  if (error || !result) {
    return;
  }
  logger.log('Deployment complete.  Resuming watch.\n');
  await delay(200).then(() => watch());
}

// Test whether a file is a symlink
function isSymlink(filename: string): boolean {
  try {
    const stat = fs.lstatSync(filename);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}
