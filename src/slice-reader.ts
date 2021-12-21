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
const debug = makeDebug('nim:deployer:slice-reader')
const TEMP = process.platform === 'win32' ? process.env.TEMP : '/tmp'
const SIGNED_URL = 'buildmgr/getSignedUrl'

// Supports the fetching and deletion of project slices from the data bucket and related management functions

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
  const { data } = await axios.get(url)  
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

async function getUrl(sliceName: string, action: string): Promise<string> {
  const bucket = process.env['BUILDER_BUCKET_NAME']
  const query = 'action=' + action +'&bucket=' + bucket + '&object=' + sliceName
  const reqUrl = process.env['__OW_API_HOST'] + '/api/v1/web/nimbella/buildmgr/getSignedUrl.json?' + query
  console.log('Invoking url', reqUrl)
  const auth = process.env['__OW_API_KEY']
  console.log('Using auth', auth)    
  const invokeResponse = await wskRequest(reqUrl, auth)
  console.log('Response:')
  console.dir(invokeResponse, { depth: null })
  const { url } = invokeResponse as any
  return url  
}

// Delete
export async function deleteSlice(project: DeployStructure): Promise<void> {
  const sliceName = path.relative(cacheArea(), project.filePath)
  const url = await getUrl(sliceName, 'delete')
  await axios.delete(url)    
}
