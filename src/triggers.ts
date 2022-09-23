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

// TEMPORARY: some of this code will, if requested, invoke actions in /nimbella/triggers/[create|delete|list]
// rather than the trigger APIs defined on api.digitalocean.com/v2/functions.  The actions in question
// implement a prototype verion of the API which is still being used as a reference implementation until
// the trigger APIs are stable and adequate.  The two are not functionally equivalent in that the prototype
// API will result in updates to the public scheduling service (not the production one in DOCC).
// 
// To request the prototype API set TRIGGERS_USE_PROTOTYPE non-empty in the environment.
//
// Unless the prototype API is used, the DO_API_KEY environment variable must be set to the DO API key that
// should be used to contact the DO API endpoint.  In doctl this key will be placed in the process 
// environment of the subprocess that runs the deployer.   If the deployer is invoked via nim rather than
// doctl, the invoking context must set this key (e.g. in the API build container or for testing).
//
// If neither environment variable is set, then trigger operations are skipped (become no-ops).
// Reasoning: the deployer should always be called by one of
//   - doctl, which will always set DO_API_KEY
//   - tests, which will knowingly set one of the two
//   - the AP build container, which should have maximum flexibility to either (1) refuse to deploy if
// the project has triggers, (2) set DO_API_KEY in the subprocess enviornment when invoking nim, (3)
// proceed with a warning and without deploying triggers.
// And, the list operation, at least, will be called routinely during cleanup operations and must be
// able to act as a no-op (return the empty list) when triggers are not being used.

import openwhisk from 'openwhisk'
import { TriggerSpec, SchedulerSourceDetails, DeploySuccess } from './deploy-struct'
import { default as axios, AxiosRequestConfig } from 'axios'
import makeDebug from 'debug'
const debug = makeDebug('nim:deployer:triggers')
const usePrototype=process.env.TRIGGERS_USE_PROTOTYPE
const doAPIKey=process.env.DO_API_KEY
const doAPIEndpoint='https://api.digitalocean.com'

export async function deployTriggers(triggers: TriggerSpec[], functionName: string, wsk: openwhisk.Client,
    namespace: string): Promise<(DeploySuccess|Error)[]> {
  const result: (DeploySuccess|Error)[] = []
  for (const trigger of triggers) {
    result.push(await deployTrigger(trigger, functionName, wsk, namespace))   
  }
  debug('finished deploying triggers, returning result')
  return result
}

export async function undeployTriggers(triggers: string[], wsk: openwhisk.Client, namespace: string): Promise<(Error|true)[]> {
  const result: (Error|true)[] = []
  for (const trigger of triggers) {
    try {
      await undeployTrigger(trigger, wsk, namespace)
      result.push(true)
    } catch (err) {
      // See comment in catch clause in deployTrigger
      if (typeof err === 'string') {
        result.push(Error(err))
      } else {
        result.push(err as Error)
      }   
    }
  }
  return result
}

// Code to deploy a trigger.
// Note that basic structural validation of each trigger has been done previously
// so paranoid checking is omitted.
async function deployTrigger(trigger: TriggerSpec, functionName: string, wsk: openwhisk.Client, namespace: string): Promise<DeploySuccess|Error> {
  const details = trigger.sourceDetails as SchedulerSourceDetails
  const { cron, withBody } = details
  const { sourceType, enabled } = trigger
  const params = {
    triggerName: trigger.name,
    function: functionName,
    sourceType,
    cron,
    withBody,
    overwrite: true,
    enabled
  }
  try {
    if (!usePrototype && doAPIKey) {
        // Call the real API
        debug('calling the real trigger API to create %s', trigger.name)
        return await doTriggerCreate(trigger.name, functionName, namespace, cron, enabled, withBody)
    } else if (usePrototype) {
        // Call the prototype API
        await wsk.actions.invoke({
          name: '/nimbella/triggers/create',
          params,
          blocking: true,
          result: true
        })
        return { name: trigger.name, kind: 'trigger', skipped: false }
    }
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
    url: doAPIEndpoint + '/v2/functions/trigger',
    method: 'post',
    data: {
      name: trigger,
      namespace,
      function: fcn,
      is_enabled: enabled !== false, // ie, defaults to true
      trigger_source: 'SCHEDULED',
      cron,
      body: withBody
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
async function undeployTrigger(trigger: string, wsk: openwhisk.Client, namespace: string) {
  debug('undeploying trigger %s', trigger)
  if (doAPIKey && !usePrototype) {
      // Use the real API
      return doTriggerDelete(trigger, namespace)
  } else if (usePrototype) {
    // Prototype API
    const params = {
      triggerName: trigger
    }
    return await wsk.actions.invoke({
      name: '/nimbella/triggers/delete',
      params,
      blocking: true,
      result: true
    })
  }
  // Else no-up.  A Promise<void> (non-error) is returned implicitly
}

// Delete a trigger using the real API
async function doTriggerDelete(trigger: string, namespace: string): Promise<object> {
  const config: AxiosRequestConfig = {
    url: doAPIEndpoint + `/v2/functions/trigger/${namespace}/${trigger}`,
    method: 'delete'
  }
  return doAxios(config)
}

// Code to get all the triggers for a namespace, or all the triggers for a function in the
// namespace.
export async function listTriggersForNamespace(wsk: openwhisk.Client, namespace: string, fcn?: string): Promise<string[]> {
  debug('listing triggers')
  if (doAPIKey && !usePrototype) {
    // Use the real API
    return doTriggerList(namespace, fcn)
  } else if (usePrototype) {
    // Use the prototype API
    const params: any = {
      name: '/nimbella/triggers/list',
      blocking: true,
      result: true
    }
    if (fcn) {
      params.params = { function: fcn }
    }
    const triggers: any = await wsk.actions.invoke(params)
    debug('triggers listed')
    return triggers.items.map((trigger: any) => trigger.triggerName)
  }
  // No-op if no envvars are set
  return []
}

// The following is my best guess on what the trigger list API is planning to return
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
    url: doAPIEndpoint + `/v2/functions/triggers/${namespace}`,
    method: 'get'
  }
  const triggers = await doAxios(config) as TriggerList
  debug('got trigger list result from real API: %O', triggers)
  if (!triggers.triggers) {
    debug('result did not have triggers member')
    return []
  }
  const filtered = fcn ? triggers.triggers.filter(trig => trig.function === fcn) : triggers.triggers
  const names = filtered.map(trig => trig.name)
  debug('reduced the list to %O', names)
  return names
}
