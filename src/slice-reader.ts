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
import { DeployStructure, OWOptions } from './deploy-struct'
import { invokeWebSecure } from './util'
import { BUILDER_NAMESPACE } from './finder-builder' 
import axios from 'axios'
import { authPersister, getCredentials } from './credentials'
const debug = makeDebug('nim:deployer:slice-reader')
const TEMP = process.platform === 'win32' ? process.env.TEMP : '/tmp'
const getSignedUrl = `/${BUILDER_NAMESPACE}/buildmgr/getSignedUrl.json`

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
async function getUrl(sliceName: string, action: string): Promise<string> {
  const bucket = process.env.BUILDER_BUCKET_NAME
  const actionAndQuery = getSignedUrl + '?action=' + action + '&bucket=' + bucket + '&object=' + sliceName
  const { apihost, api_key } = await getOpenWhiskCreds()
  debug(`Invoking with '%s', apihost= '%s', auth='%s'`, actionAndQuery, apihost, api_key)
  const invokeResponse = await invokeWebSecure(actionAndQuery, api_key, apihost)
  debug('Response: %O', invokeResponse)
  const { url } = invokeResponse as any
  return url  
}

// Get the API host to use for secure web action invoke.  This will be in an environment
// variable when running in an action (the usual case) or in the credential store (local replay).
async function getOpenWhiskCreds(): Promise<OWOptions> {
    const apihost = process.env.__OW_API_HOST || process.env.savedOW_API_HOST
    const api_key = process.env.__OW_API_KEY || process.env.savedOW_API_KEY
    if (apihost && api_key) {
      return {apihost, api_key}
    }
    const creds = await getCredentials(authPersister)  
    return creds.ow
}

// Delete
export async function deleteSlice(project: DeployStructure): Promise<void> {
  const sliceName = path.relative(cacheArea(), project.filePath)
  const url = await getUrl(sliceName, 'delete')
  await axios.delete(url)    
}
