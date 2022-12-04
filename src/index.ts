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

// Gather together the major deployer exports for convenient import in other packages

export {
  initializeAPI,
  deployProject,
  readPrepareAndBuild,
  readAndPrepare,
  deploy,
  readProject,
  buildProject,
  prepareToDeploy,
  wipeNamespace,
  wipePackage,
  getUserAgent
} from './api';
export {
  DeployStructure,
  DeployResponse,
  DeploySuccess,
  OWOptions,
  Credentials,
  CredentialRow,
  Flags,
  PackageSpec,
  ActionSpec,
  CredentialHostMap,
  CredentialNSMap,
  DeployerAnnotation,
  VersionMap,
  Feedback,
  DefaultFeedback,
  FullCredentials,
  IdProvider
} from './deploy-struct';
export {
  addCredentialAndSave,
  getCredentials,
  getCredentialList,
  getCredentialDict,
  getCredentialsForNamespace,
  forgetNamespace,
  switchNamespace,
  getCurrentNamespace,
  getApiHosts,
  Persister,
  authPersister,
  getCredentialsFromEnvironment,
  nimbellaDir
} from './credentials';
export {
  wskRequest,
  delay,
  writeSliceResult,
  getBestProjectName,
  renamePackage,
  getExclusionList,
  isExcluded,
  SYSTEM_EXCLUDE_PATTERNS,
  getRuntimeForAction,
  emptyStructure,
  invokeWebSecure,
  renameActionsToFunctions,
  deleteAction
} from './util';
export * from './runtimes';
export { deleteSlice } from './slice-reader';
export { makeIncluder } from './includer';
export {
  DefaultLogger,
  CaptureLogger,
  runCommand,
  main,
  flush,
  handleError
} from './main';
