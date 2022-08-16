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
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { Readable, Writable } from 'stream'
import { WritableStream } from 'memory-streams'

const debug = makeDebug('nim:deployer:slice-reader')
const TEMP = process.platform === 'win32' ? process.env.TEMP : '/tmp'
const bucket = process.env.BUILDER_BUCKET_NAME
const endpoint = process.env.S3_ENDPOINT
// Environment must also contain AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY

// MAX_SLICE_UPLOAD_SIZE governs the maximum supported zipped size for a project slice 
export const MAX_SLICE_UPLOAD_SIZE = parseInt(process.env.MAX_SLICE_UPLOAD_SIZE) || 64 * 1024 * 1024

let s3Client: S3Client

// Supports the fetching and deletion of project slices from build bucket.
// Uses the aws s3 client directly (does not go through the Nimbella storage
// abstraction).  Assumes the necessary s3 properties are in the environment.
// This will not work on older clusters (e.g `nimgcp`) where the use of a data
// bucket associated with the namespace is assumed.  A nim CLI < 2.0.0 must be
// used for those clusters.

// Get the cache area
function cacheArea() {
  return path.join(TEMP, 'slices')
}

// Get the s3 client
function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ endpoint, region: "us-east-1" })
  }
  return s3Client
}

// Pipe data from one stream to another
function pipe(input: Readable, output: Writable): Promise<unknown> {
  const toWait = new Promise(function(resolve) {
    output.on('close', () => {
      resolve(true)
    })
    output.on('finish', () => {
      resolve(true)
    })
  })
  input.pipe(output)
  return toWait
}

// Fetch the slice to cache storage.
export async function fetchSlice(sliceName: string): Promise<string> {
  const cache = path.join(cacheArea(), sliceName)
  if (fs.existsSync(cache)) {
    rimraf.sync(cache)
  }
  debug('Making cache directory: %s', cache)
  fs.mkdirSync(cache, { recursive: true })
  const s3 = getS3Client()
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: sliceName })
  const result = await s3.send(cmd)
  const content = result.Body as Readable // Body has type ReadableStream<any>|Readable|Blob.  Readable seems to work in practice
  const destination = new WritableStream({ highWaterMark: MAX_SLICE_UPLOAD_SIZE })
  await pipe(content, destination)
  const data = (destination as WritableStream).toBuffer()
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

// Delete
export async function deleteSlice(project: DeployStructure): Promise<void> {
  const sliceName = path.relative(cacheArea(), project.filePath)
  const s3 = getS3Client()
  const cmd = new DeleteObjectCommand({ Bucket: bucket, Key: sliceName })
  await s3.send(cmd)
}
