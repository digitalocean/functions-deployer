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

import * as path from 'path'
import * as fs from 'fs'
import makeDebug from 'debug'
import Zip from 'adm-zip'
import * as rimraf from 'rimraf'
import { DeployStructure } from './deploy-struct'
import { wskRequest } from './util'
import axios from 'axios'
import { authPersister, getCredentials } from './credentials'
const debug = makeDebug('nim:deployer:slice-reader')
const TEMP = process.platform === 'win32' ? process.env.TEMP : '/tmp'

// Supports the fetching and deletion of project slices from build bucket.
// Uses the new getSignedUrl (web secure) function in buildmgr so that the
// build bucket and data bucket may be different.  Not supported on clusters
// in which the new action is not installed. 

// Get the cache area
function cacheArea() {
  return path.join(TEMP, 'slices')
}

// Fetch the slice to cache storage.
export async function fetchSlice(sliceName: string): Promise<string> {
  const cache = path.join(cacheArea(), sliceName)
  if (fs.existsSync(cache)) {
    rimraf.sync(cache)
  }
  debug('Making cache directory: %s', cache)
  fs.mkdirSync(cache, { recursive: true })
  await ensureEnvironment()
  const url = await getUrl(sliceName, 'read')
  const { data } = await axios.get(url, { responseType: 'arraybuffer' })
  const zip = new Zip(data)
  debug('zip file has %d entries', zip.getEntries().length)
  for (const entry of zip.getEntries().filter(entry => !entry.isDirectory)) {
    const target = path.join(cache, entry.entryName)
    const parent = path.dirname(target)
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true })
    }
    const mode = entry.attr >>> 16
    debug('storing %s', entry.entryName)
    fs.writeFileSync(target, entry.getData(), { mode })
  }
  return cache
}

// Get a signed URL for reading or deleting the slice.
// Because this usually executes in builder actions and not locally, the
// credentials are not used but instead environment variables are expected
// to provide the necessary information.
async function getUrl(sliceName: string, action: string): Promise<string> {
  const bucket = process.env['BUILDER_BUCKET_NAME']
  const query = 'action=' + action +'&bucket=' + bucket + '&object=' + sliceName
  const reqUrl = process.env['__OW_API_HOST'] + '/api/v1/web/nimbella/buildmgr/getSignedUrl.json?' + query
  const auth = process.env['__OW_API_KEY']
  debug(`Invoking url '%s' using auth '%s'`, reqUrl, auth)    
  const invokeResponse = await wskRequest(reqUrl, auth)
  debug('Response: %O', invokeResponse)
  const { url } = invokeResponse as any
  return url  
}

// For testing, where the environment is not primed but a credential store exists, prime the environment
// Note: BUILDER_BUCKET_NAME _must_ be set in the environment.  That cannot be repaired here.
async function ensureEnvironment() {
    if (process.env['__OW_API_HOST'] && process.env['__OW_API_KEY']) {
      return
    }
    const creds = await getCredentials(authPersister)
    process.env['__OW_API_HOST'] = creds.ow.apihost
    process.env['__OW_API_KEY'] = creds.ow.api_key
}

// Delete
export async function deleteSlice(project: DeployStructure): Promise<void> {
  const sliceName = path.relative(cacheArea(), project.filePath)
  const url = await getUrl(sliceName, 'delete')
  await axios.delete(url)    
}
