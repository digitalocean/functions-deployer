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

// Functions to manage the credential store.

import * as fs from 'fs';
import * as path from 'path';
import {
  CredentialStore,
  CredentialEntry,
  Credentials,
  CredentialRow,
  Feedback
} from './deploy-struct';
import createDebug from 'debug';
import { wskRequest } from './util';
const debug = createDebug('nimbella.cli');

// Non-exported constants
const HOME = process.env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME'];
const NAMESPACE_URL_PATH = '/api/v1/namespaces';
const NIMBELLA_DIR = '.nimbella';
const WSK_PROPS = 'wskprops';
const CREDENTIAL_STORE = 'credentials.json';
// Function indirection needed for webpack
export function nimbellaDir(): string {
  const fromEnv = process.env.NIMBELLA_DIR;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  return path.join(HOME, NIMBELLA_DIR);
}
function wskProps() {
  return path.join(nimbellaDir(), WSK_PROPS);
}
function credentialStore() {
  return path.join(nimbellaDir(), CREDENTIAL_STORE);
}

// Exports

// The type of a persistance manager, which will differ between cloud and local
export interface Persister {
  loadCredentialStoreIfPresent: () => CredentialStore;
  loadCredentialStore: () => Promise<CredentialStore>;
  saveCredentialStore: (store: CredentialStore) => void;
  saveLegacyInfo: (apihost: string, auth: string) => void;
}

// The persister to use when local storage is accessible.
// This can be replaced to bypass file system access.
const fileSystemPersister: Persister = {
  loadCredentialStoreIfPresent,
  loadCredentialStore,
  saveCredentialStore,
  saveLegacyInfo
};

// The persister to use for all auth code.
// Not a constant so that it can be explicitly set to bypass file system access.
export const authPersister = fileSystemPersister;

// Add credential to credential store and make it the default.  Does not persist the result
export function addCredential(
  store: CredentialStore,
  apihost: string,
  namespace: string,
  api_key: string
): Credentials {
  debug('Adding credential to credential store');
  let nsMap = store.credentials[apihost];
  if (!nsMap) {
    nsMap = {};
    store.credentials[apihost] = nsMap;
  }
  nsMap[namespace] = { api_key };
  store.currentHost = apihost;
  store.currentNamespace = namespace;
  return {
    namespace,
    ow: { apihost, api_key },
    do_token: process.env.DO_API_KEY
  };
}

// Remove a namespace from the credential store
export async function forgetNamespace(
  namespace: string,
  apihost: string | undefined,
  feedback: Feedback
): Promise<Credentials> {
  const store = await authPersister.loadCredentialStore();
  const creds = getUniqueCredentials(namespace, apihost, store);
  const host = apihost || creds.ow.apihost;
  const hostMap = store.credentials[host];
  let undefinedWarning = false;
  if (hostMap && hostMap[namespace]) {
    delete hostMap[namespace];
    if (host === store.currentHost && store.currentNamespace === namespace) {
      store.currentNamespace = undefined;
      undefinedWarning = true;
      try {
        fs.unlinkSync(wskProps());
      } catch {
        // Do nothing
      }
    }
    authPersister.saveCredentialStore(store);
    if (undefinedWarning) {
      feedback.warn(`'${namespace}' was the current namespace`);
      feedback.warn(
        'A new namespace target must be specified on or before the next project deployment'
      );
    }
  } else {
    feedback.warn(
      `There is no credential entry for namespace '${namespace}' on API host '${host}'`
    );
  }
  return creds;
}

// Switch the active namespace in the credential store.  The namespace argument is required.
// All occurrences of the namespace across all API hosts are collected.
// If there is an explicit 'apihost' argument this collection must include an entry with that API host
// Otherwise,
//   - if there is just one occurrence, the switch is to that namespace on that API host
//   - otherwise, no switch occurs and the thrown Error either states that no credentials exist for that namespace
//     or that the --apihost flag is required to indicate which one is intended
export async function switchNamespace(
  namespace: string,
  apihost: string | undefined
): Promise<Credentials> {
  const store = await authPersister.loadCredentialStore();
  const answer = getUniqueCredentials(namespace, apihost, store);
  const newHost = answer.ow.apihost;
  if (store.currentHost === newHost && store.currentNamespace === namespace) {
    debug('not an actual change');
    return answer;
  }
  store.currentHost = newHost;
  store.currentNamespace = namespace;
  authPersister.saveCredentialStore(store);
  authPersister.saveLegacyInfo(newHost, answer.ow.api_key);
  debug(`Switched target namespace to '${namespace}' on API host '${newHost}'`);
  return answer;
}

// Get a valid Credentials object by finding the information in the environment.   This will generally not work in the
// CLI context but is designed to work via the deployer API when running in actions.  It may be especially
// useful in shared packages, where the credentials in the environment will vary by invoking user.
// For the information to be fully usable the environment must include __OW_API_KEY, which is only present when
// the action is annotated with provide-api-key=true.
// If the environment is inadequate to support this API, an error is generally not indicated.  Instead,
// an incomplete Credentials object is returned.
export function getCredentialsFromEnvironment(): Credentials {
  const apihost = process.env.__OW_API_HOST;
  const namespace = process.env.__OW_NAMESPACE;
  const api_key = process.env.__OW_API_KEY;
  const do_token = process.env.DO_API_KEY;
  return { namespace, ow: { api_key, apihost }, do_token };
}

// Get the credentials for a namespace.  Similar logic to switchNamespace but does not change which
// namespace is considered current.
export async function getCredentialsForNamespace(
  namespace: string,
  apihost: string | undefined
): Promise<Credentials> {
  const store = await authPersister.loadCredentialStore();
  return getUniqueCredentials(namespace, apihost, store);
}

// Get the current credentials.  This will succeed iff the user has a credential store and a current namespace.
// Otherwise, we throw an error.
export async function getCredentials(): Promise<Credentials> {
  const store = await authPersister.loadCredentialStore();
  if (!store.currentHost || !store.currentNamespace) {
    throw new Error(
      "You do not have a current namespace.  Use 'nim auth login' to create a new one or 'nim auth switch' to use an existing one"
    );
  }
  const entry = store.credentials[store.currentHost][store.currentNamespace];
  const { api_key } = entry;
  return {
    namespace: store.currentNamespace,
    ow: { apihost: store.currentHost, api_key },
    do_token: process.env.DO_API_KEY
  };
}

// Convenience function to load, add, save a new credential.
export async function addCredentialAndSave(
  apihost: string,
  auth: string,
  namespace: string
): Promise<Credentials> {
  const credStore = await authPersister.loadCredentialStore();
  const nsPromise = namespace
    ? Promise.resolve(namespace)
    : getNamespace(apihost, auth);
  return nsPromise.then((namespace) => {
    const credentials = addCredential(credStore, apihost, namespace, auth);
    authPersister.saveCredentialStore(credStore);
    return credentials;
  });
}

// Provide contents of the CredentialStore in a dictionary style suitable for listing and tabular presentation
export async function getCredentialDict(): Promise<{
  [host: string]: CredentialRow[];
}> {
  const store = await authPersister.loadCredentialStore();
  const result: { [host: string]: CredentialRow[] } = {};
  for (const apihost in store.credentials) {
    let rows: CredentialRow[] = [];
    for (const namespace in store.credentials[apihost]) {
      const current =
        apihost === store.currentHost && namespace === store.currentNamespace;
      rows.push({ namespace, current, apihost });
      rows = rows.sort((a, b) => a.namespace.localeCompare(b.namespace));
    }
    result[apihost] = rows;
  }
  return result;
}

// Get the list of apihosts from the credential store
export async function getApiHosts(persister: Persister): Promise<string[]> {
  const store = await persister.loadCredentialStore();
  return Object.keys(store.credentials);
}

// Flat (single array) version of getCredentialDict
export async function getCredentialList(): Promise<CredentialRow[]> {
  const dict = await getCredentialDict();
  return Object.values(dict).reduce((acc, val) => acc.concat(val), []);
}

// Get the namespace associated with an auth on a specific host
export function getNamespace(host: string, auth: string): Promise<string> {
  debug('getting current namespace');
  const url = host + NAMESPACE_URL_PATH;
  return wskRequest(url, auth).then((list) => list[0]);
}

// Get current namespace
export async function getCurrentNamespace(): Promise<string | undefined> {
  debug('getting current namespace');
  const store = await authPersister.loadCredentialStore();
  return store.currentNamespace;
}

// fileSystemPersister functions (indirectly exported)
function saveCredentialStore(store: CredentialStore): void {
  const toWrite = JSON.stringify(store, null, 2);
  debug('writing credential store');
  fs.writeFileSync(credentialStore(), toWrite, { mode: 0o600 });
}

function saveLegacyInfo(apihost: string, auth: string): void {
  saveWskProps(apihost, auth);
  debug('stored .wskprops with API host %s', apihost);
}

function loadCredentialStore(): Promise<CredentialStore> {
  // Returns a promise for historical reasons.  Could be tweaked since
  // the promise is no longer needed.
  if (!fs.existsSync(credentialStore())) {
    return Promise.resolve(initialCredentialStore());
  }
  const contents = fs.readFileSync(credentialStore());
  return Promise.resolve(JSON.parse(String(contents)));
}

function loadCredentialStoreIfPresent(): CredentialStore {
  if (!fs.existsSync(credentialStore())) {
    return undefined;
  }
  const contents = fs.readFileSync(credentialStore());
  return JSON.parse(String(contents));
}

// Utility functions (not exported)

// Make the initial credential store when none exists.  It always starts out empty.  This also makes
// the parent directory preparatory to the first write.  It does not actually write the credential store.
function initialCredentialStore(): CredentialStore {
  if (!fs.existsSync(nimbellaDir())) {
    fs.mkdirSync(nimbellaDir(), { mode: 0o700 });
  }
  return {
    currentHost: undefined,
    currentNamespace: undefined,
    credentials: {}
  };
}

// Write ~/.nimbella/wskprops.  Used when the default api host or api key change (TODO: this never saves the 'insecure' flag; that should
// probably be correlated with the api host)
function saveWskProps(apihost: string, auth: string) {
  const wskPropsContents = `APIHOST=${apihost}\nAUTH=${auth}\n`;
  fs.writeFileSync(wskProps(), wskPropsContents, { mode: 0o600 });
}

// Given a namespace and _optionally_ an apihost, return the credentials, throwing errors based on the
// number of matches.  Used in cases where the credentials are expected to exist but the client may or
// may not have provided an API host
function getUniqueCredentials(
  namespace: string,
  apihost: string | undefined,
  store: CredentialStore
): Credentials {
  const possibles: { [key: string]: CredentialEntry } = {};
  let credentialEntry: CredentialEntry;
  let newHost: string;
  for (const host in store.credentials) {
    const entry = store.credentials[host][namespace];
    if (entry) {
      possibles[host] = entry;
    }
  }
  if (apihost) {
    if (possibles[apihost]) {
      credentialEntry = possibles[apihost];
      newHost = apihost;
    } else {
      throw new Error(
        `No credentials found for namespace '${namespace}' on API host '${apihost}'`
      );
    }
  } else {
    const pairs = Object.entries(possibles);
    if (pairs.length === 1) {
      [newHost, credentialEntry] = pairs[0];
    } else if (pairs.length === 0) {
      throw new Error(
        `No credentials found for namespace '${namespace}' on any API host`
      );
    } else {
      throw new Error(
        `The namespace '${namespace}' exists on more than one API host.  An '--apihost' argument is required`
      );
    }
  }
  const { api_key } = credentialEntry;
  debug('have authkey: %s', api_key);
  return {
    namespace,
    ow: { apihost: newHost, api_key },
    do_token: process.env.DO_API_KEY
  };
}

// GitHub credentials section

// Retrieve a list of locally known github accounts
export async function getGithubAccounts(): Promise<{ [key: string]: string }> {
  const store = await authPersister.loadCredentialStore();
  debug('GitHub accounts requested, returning %O', store.github);
  return store.github || {};
}

// Delete a github account
type DeleteResult = 'DeletedOk' | 'DeletedDangling' | 'NotExists';
export async function deleteGithubAccount(name: string): Promise<DeleteResult> {
  const store = await authPersister.loadCredentialStore();
  if (store.github && store.github[name]) {
    delete store.github[name];
    if (name === store.currentGithub) {
      store.currentGithub = undefined;
    }
    debug(
      'GitHub deletion of account %s succeeded, with currentGithub=%s',
      name,
      store.currentGithub
    );
    authPersister.saveCredentialStore(store);
    return store.currentGithub ? 'DeletedOk' : 'DeletedDangling';
  } else {
    return 'NotExists';
  }
}

// Get active github token
export function getGithubAuth(): string {
  const store = authPersister.loadCredentialStoreIfPresent();
  if (store && store.github && store.currentGithub) {
    return store.github[store.currentGithub];
  }
  return undefined;
}

// Switch the active github account
export async function switchGithubAccount(name: string): Promise<boolean> {
  const store = await authPersister.loadCredentialStore();
  if (store.github && store.github[name]) {
    store.currentGithub = name;
    authPersister.saveCredentialStore(store);
    return true;
  } else {
    return false;
  }
}

// Add a github account
export async function addGithubAccount(
  name: string,
  token: string
): Promise<void> {
  const store = await authPersister.loadCredentialStore();
  if (!store.github) {
    store.github = {};
  }
  debug('adding github account with name %s and token %s', name, token);
  store.github[name] = token;
  store.currentGithub = name;
  authPersister.saveCredentialStore(store);
}
