import axios, { AxiosInstance } from 'axios'
import { getCredentials } from './credentials'
import { Credentials } from './deploy-struct'

import debug from 'debug'
const debug_log = debug('nim:deployer:runtimes')

export const API_ENDPOINT = '/api/v1'

let cachedRuntimes: RuntimesConfig

// Static table to use if the host cannot be contacted
const staticRuntimes: RuntimesConfig = {
  "go": [
    {
      "default": false,
      "kind": "go:1.15"
    },
    {
      "default": true,
      "kind": "go:1.17"
    }
  ],
  "nodejs": [
    {
      "default": true,
      "kind": "nodejs:14"
    },
    {
      "default": false,
      "kind": "nodejs-lambda:14"
    },
    {
      "default": false,
      "kind": "nodejs:18"
    },
    {
      "default": false,
      "kind": "nodejs-lambda:18"
    }
  ],
  "php": [
    {
      "default": true,
      "kind": "php:8.0"
    }
  ],
  "python": [
    {
      "default": true,
      "kind": "python:3.9"
    }
  ]
}

// Custom types for runtimes.json configuration parameters
type RuntimeLabel = string
type RuntimeKind = string
type RuntimeFileExtension = string

export interface Runtime {
  kind: RuntimeKind
  default?: boolean
}

export type RuntimesConfig = Record<RuntimeLabel, Runtime[]>

// List of file extensions for runtimes. This hardcoded list used to be present
// in the extensions field of the runtimes.json document.
// The commented-out lines are not currently supported by DigitalOcean;
// some may be supported in the future.
const FileExtensionRuntimes: Record<RuntimeKind, RuntimeFileExtension[]> = {
  'go': ['go'],
//  'java': ['java', 'jar'],
  'nodejs': ['js', 'ts'], // nodejs works for both javascript and typescript
//  'typescript': ['ts'],
  'php': ['php'],
  'python': ['py'],
//  'ruby': ['rb'],
//  'rust': ['rs'],
//  'swift': ['swift'],
//  'deno': ['ts', 'js'],
//  'dotnet': ['cs', 'vb']
}

// File extensions which imply binary data
const BinaryFileExtensions: Set<RuntimeFileExtension> = new Set<RuntimeFileExtension>(['zip', 'jar'])

// Send HTTP request to platform endpoint for runtimes configuration
export async function fromPlatform(httpClient: AxiosInstance, platformUrl: string): Promise<Record<string, unknown>> {
  const url = `${platformUrl}${API_ENDPOINT}`
  debug_log(`loading runtimes from platform @ ${url}`)
  try {
    const { data } = await httpClient.get(url)
    debug_log(`loaded runtimes json: ${JSON.stringify(data)}`)
    return data?.runtimes
  } catch (err) {
    // Error due to HTTP Code > 2XX
    if (err.response) {
      throw new Error(`http request failed (${url}) with status (${err.response.status}): ${err.response.statusText} `)
      // or response never received
    } else if (err.request) {
      throw new Error(`http request failed: GET ${url}`)
      // or something else...
    } else {
      throw err
    }
  }
}

// Compute the runtime from the file extension.
export function runtimeForFileExtension(fileExtension: RuntimeFileExtension): RuntimeKind | undefined {
  const runtime = Object.entries(FileExtensionRuntimes).find((item, i) => item[1].includes(fileExtension))
  return (runtime && runtime.length > 0) ? `${runtime[0]}:default` : undefined
}

// Does file extension imply binary data?
export function isBinaryFileExtension(fileExtension: RuntimeFileExtension): boolean {
  return BinaryFileExtensions.has(fileExtension)
}

// Compute the expected file extension from a runtime name. 
// Runtime returned should match the option for whether file extension refers to binary data
export function fileExtensionForRuntime(runtime: RuntimeKind, isBinaryExtension: boolean): RuntimeFileExtension {
  debug_log(`fileExtensionForRuntime: runtime (${runtime}) binary (${isBinaryExtension})`)
  const isSameRuntime = (r: string): boolean => r.includes(runtime)
  const isValidRuntime = Object.keys(FileExtensionRuntimes).some(isSameRuntime)
  if (!isValidRuntime) throw new Error(`Invalid runtime ${runtime} encountered`)

  return isBinaryExtension ? FileExtensionRuntimes[runtime].filter((item) => BinaryFileExtensions.has(item))[0] : FileExtensionRuntimes[runtime][0]
}

// Does the runtime kind exist in the platform config?
export async function isValidRuntime(kind: RuntimeKind): Promise<boolean> {
  debug_log(`isValidRuntime: kind (${kind})`)
  let exactMatch = true
  if (kind.endsWith(':default')) {
    kind = kind.split(':')[0] + ':'
    exactMatch = false
  }
  debug_log('searching')
  const runtimes = await getRuntimes()
  for (const runtimeArray of Object.values(runtimes)) {
    for (const runtime of runtimeArray) {
      if (exactMatch && kind === runtime.kind) {
        debug_log(`${kind}===${runtime.kind}`)
        return true
      } else if (!exactMatch && runtime.kind.startsWith(kind) && runtime.default) {
        debug_log(`${runtime.kind} starts with ${kind} and is the default`)
        return true
      }
      debug_log(`no match on ${runtime.kind}`)
    }
  }
  return false
}

// Find the default runtime for a language
export function defaultRuntime(runtimes: RuntimesConfig, label: RuntimeLabel): RuntimeKind {
  debug_log(`defaultRuntime: runtimes (${runtimes}) label (${label})`)
  const kinds = runtimes[label] ?? []
  const defaultRuntime = kinds.find(k => k.default) ?? { kind: undefined }
  return defaultRuntime.kind
}

// Compute a runtime kind from the 'mid string' of a file name of the form name.runtime.zip
export async function runtimeForZipMid(mid: string): Promise<RuntimeKind> {
  const runtime = mid.includes('-') ? mid.replace('-', ':') : `${mid}:default`
  return await isValidRuntime(runtime) ? runtime : undefined
}

// Return default kind for runtime label - if explicit version isn't used.
export async function canonicalRuntime(runtime: RuntimeKind): Promise<RuntimeKind> {
  if (runtime.endsWith(':default')) {
    const [label] = runtime.split(':')
    const runtimes = await getRuntimes()
    return defaultRuntime(runtimes, label)
  }
  return runtime
}

// Custom type guard to ensure JSON response is in the correct format
function isValidRuntimesJson(src: Record<string, unknown>): src is RuntimesConfig {
  return Object.values(src).every(v => Array.isArray(v) && v.every(k => k.hasOwnProperty('kind')))
}

// Load runtimes JSON configuration file from platform endpoint
export async function load(apihost: string): Promise<RuntimesConfig> {
  const runtimes = await fromPlatform(axios, apihost)
  if (!isValidRuntimesJson(runtimes)) {
    throw new Error(`Invalid runtime JSON received from platform API: ${apihost}`)
  }
  return runtimes
}

// Get the runtimes configuration.  This code assumes that _either_ all API hosts are equivalent
// _or_ only one API host is used in the module lifetime.
// The parsed runtime configuration will be stored in a local cache and returned after the first call.
// If no API host can be determined or there is an error contacting the host, then a built-in table
// is returned (this information changes slowly and so the built-in value can't be terribly stale).
export async function getRuntimes(): Promise<RuntimesConfig> {
  if (cachedRuntimes) {
    return cachedRuntimes
  }
  // Determine the API host either by reading the credential store or looking in the environment.
  // The latter is needed when running in a container performing remote build, since there may not be
  // any credential store.
  let creds: Credentials
  try {
    creds = await getCredentials()
  } catch {}
  const apihost = creds?.ow?.apihost || process.env.__OW_API_HOST || process.env.savedOW_API_HOST
  if (apihost) {
    cachedRuntimes = await load(apihost)
  } else {
    cachedRuntimes = staticRuntimes
  }
  return cachedRuntimes
}
