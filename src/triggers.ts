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

// Includes support for installing triggers and removing in the scheduling server, when such triggers 
// are attached to an action.  Currently, only sourceType=scheduler is supported for triggers.  Others will
// be rejected.  Eventually, this can be replaced by a dispatching discipline of some sort that looks at the
// sourceType and calls specialized code for that source type.

// TEMPORARY: this code is invoking actions in /nimbella/triggers/[create|delete|list|get] rather than
// APIs more closely associated with the scheduling service.   This is likely to change if this
// direction is adopted longer term. This should be the only file that has to change.

import openwhisk from 'openwhisk'
import { TriggerSpec, SchedulerSourceDetails } from './deploy-struct'

export async function deployTriggers(triggers: TriggerSpec[], functionName: string, 
    wsk: openwhisk.Client): Promise<object[]> {
  const promises: Promise<object>[] = []
  for (const trigger of triggers) {
    promises.push(deployTrigger(trigger, functionName, wsk))   
  }
  return Promise.all(promises)
}

export async function undeployTriggers(triggers: string[], wsk: openwhisk.Client): Promise<void> {
  for (const trigger of triggers) {
    await undeployTrigger(trigger, wsk)
  }
}

// Temporary code to deploy the trigger using the prototype API
// Note that basic structural validation of each trigger has been done previously
// so paranoid checking is omitted.
async function deployTrigger(trigger: TriggerSpec, functionName: string, wsk: openwhisk.Client): Promise<object> {
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
  return await wsk.actions.invoke({
    name: '/nimbella/triggers/create',
    params,
    blocking: true,
    result: true
  })
}

// Temporary code to undeploy a trigger using the prototype API
async function undeployTrigger(trigger: string, wsk: openwhisk.Client) {
  const params = {
    triggerName: trigger
  }
  console.log('undeploying', trigger)
  return await wsk.actions.invoke({
    name: '/nimbella/triggers/delete',
    params,
    blocking: true,
    result: true
  })
}

// Temporary code to get all the triggers for a namespace using the prototype API
export async function listTriggersForNamespace(wsk: openwhisk.Client): Promise<string[]> {
  const triggers = await wsk.actions.invoke({
    name: '/nimbella/triggers/list',
    blocking: true,
    result: true
  })
  return triggers.items.map(trigger => trigger.triggerName)
}