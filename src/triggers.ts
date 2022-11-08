/*
 * Copyright (c) 2022 - present DigitalOcean, LLC
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

// Includes support for listing, installing, and removing triggers, when such triggers are attached to
// an action.

// Note well: this code is prepared to succeed silently (no-op) in contexts where the authorization to
// manage triggers is absent.  To make the code do something, the DO_API_KEY environment variable must be
// set to the DO API key that should be used to contact the DO API endpoint.  In doctl, this key will be 
// placed in the process environment of the subprocess that runs the deployer.   If the deployer is invoked
// via nim rather than doctl, the invoking context must set this key (e.g. in the app platform build container
// or for testing).

import { TriggerSpec, DeploySuccess } from './deploy-struct'
import { default as axios, AxiosRequestConfig } from 'axios'
import makeDebug from 'debug'
const debug = makeDebug('nim:deployer:triggers')
const doAPIKey=process.env.DO_API_KEY
const doAPIEndpoint='https://api.digitalocean.com'

// Returns an array.  Elements are a either DeploySuccess structure for use in reporting when the trigger
// is deployed successfully, or an Error if the trigger failed to deploy.  These are 1-1 with the input
// triggers argument.
export async function deployTriggers(triggers: TriggerSpec[], functionName: string, namespace: string): Promise<(DeploySuccess|Error)[]> {
  const result: (DeploySuccess|Error)[] = []
  for (const trigger of triggers) {
    result.push(await deployTrigger(trigger, functionName, namespace))   
  }
  debug('finished deploying triggers, returning result')
  return result
}

// Undeploy one or more triggers.  Returns the empty array on success.  Otherwise, the return
// contains all the errors from attempted deletions.
export async function undeployTriggers(triggers: string[], namespace: string): Promise<Error[]> {
  const errors: any[] = []
  for (const trigger of triggers) {
    try {
      await undeployTrigger(trigger, namespace)
    } catch (err) {
      const msg = err.message ? err.message : err
      errors.push(new Error(`unable to undeploy trigger '${trigger}': ${msg}`))   
    }
  }
  return errors
}

// Code to deploy a trigger.
// Note that basic structural validation of each trigger has been done previously
// so paranoid checking is omitted.
async function deployTrigger(trigger: TriggerSpec, functionName: string, namespace: string): Promise<DeploySuccess|Error> {
  const details = trigger.scheduledDetails
  const { cron, body } = details
  const { enabled } = trigger
  try {
    if (doAPIKey) {
        debug('calling the trigger API to create %s', trigger.name)
        return await doTriggerCreate(trigger.name, functionName, namespace, cron, enabled, body)
    } // otherwise do nothing
  } catch (err) {
    debug('caught an error while deploying trigger; will return it')
    // Assume 'err' is either string or Error in the following.  Actually it can be anything but use of
    // other types is rare.
    if (typeof err === 'string') {
      return new Error(err)
    }
    return err as Error // TODO this could lead to a type error eventually if err isn't an Error
  }
  // Neither envvar is set.  No-op
  return { name: trigger.name, kind: 'trigger', skipped: true }
}

// Create a trigger using the real API.  Note: the prototype API has the capability to do an UPSERT (by
// setting the overwrite flag) and we use this.  Here, we need to simulate the effect by doing a speculative
// delete, ignoring 404 errors (actually, we are ignoring all errors, which is probably adequate).
async function doTriggerCreate(trigger: string, fcn: string, namespace: string, cron: string, enabled: boolean, withBody: object): Promise<DeploySuccess> {
  try {
    await doTriggerDelete(trigger, namespace)
  } catch {}
  const config: AxiosRequestConfig = {
    url: `${doAPIEndpoint}/v2/functions/namespaces/${namespace}/triggers`,
    method: 'post',
    data: {
      name: trigger,
      function: fcn,
      is_enabled: enabled !== false, // ie, defaults to true
      type: 'SCHEDULED',
      scheduled_details: {
        cron,
        body: withBody
      }
    }
  }
  debug('trigger create request config is: %O', config)
  await doAxios(config)
  return { name: trigger, kind: 'trigger', skipped: false }
}

// Perform a network operation with axios, given a config object.
// The config object should be complete except for headers.  The auth header
// is added here.  The function assumes that doApiKey is set.
async function doAxios(config: AxiosRequestConfig): Promise<object> {
  config.headers = {
    Authorization: `Bearer ${doAPIKey}`
  }
  const response = await axios(config)
  return response.data
}

// Code to delete a trigger.
async function undeployTrigger(trigger: string, namespace: string) {
  debug('undeploying trigger %s', trigger)
  if (doAPIKey) {
      return doTriggerDelete(trigger, namespace)
  }
  // Else no-up.  A Promise<void> (non-error) is returned implicitly
}

// Delete a trigger using the real API
async function doTriggerDelete(trigger: string, namespace: string): Promise<object> {
  const config: AxiosRequestConfig = {
    url: `${doAPIEndpoint}/v2/functions/namespaces/${namespace}/triggers/${trigger}`,
    method: 'delete'
  }
  return doAxios(config)
}

// Code to get all the triggers for a namespace, or all the triggers for a function in the namespace.
export async function listTriggersForNamespace(namespace: string, fcn?: string): Promise<string[]> {
  debug('listing triggers')
  if (doAPIKey) {
    return doTriggerList(namespace, fcn)
  }
  // No-op if no envvars are set
  return []
}

// The trigger list API returns this structure (abridged here to just what we care about)
interface TriggerList {
  triggers: TriggerInfo[]
}
interface TriggerInfo {
  name: string
  function: string
}

// List triggers using the real API.  Currently, filtering by function is not
// provided by the API so it is done here.
async function doTriggerList(namespace: string, fcn: string): Promise<string[]> {
  const config: AxiosRequestConfig = {
    url: `${doAPIEndpoint}/v2/functions/namespaces/${namespace}/triggers`,
    method: 'get'
  }
  let triggers: TriggerList
  try {
    triggers = await doAxios(config) as TriggerList
  } catch (err) {
    debug('error listing triggers: %s', err.message)
    return [] 
  }
  debug('got trigger list result from the API: %O', triggers)
  if (!triggers.triggers) {
    debug('result did not have triggers member')
    return []
  }
  const filtered = fcn ? triggers.triggers.filter(trig => trig.function === fcn) : triggers.triggers
  const names = filtered.map(trig => trig.name)
  debug('reduced the list to %O', names)
  return names
}
