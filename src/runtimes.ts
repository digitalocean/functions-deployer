import type { AxiosInstance } from 'axios'
import axios from 'axios';
import {getCredentials, authPersister} from './credentials'

export const API_ENDPOINT = '/api/v1'

// Custom types for runtimes.json configuration parameters
type RuntimeLabel = string
type RuntimeKind = string
type RuntimeFileExtension = string

export interface Runtime {
  kind: RuntimeKind 
  default?: boolean
}

export type RuntimesConfig = Record<RuntimeLabel, Runtime[]> 
export type DefaultRuntimes = Record<RuntimeLabel, RuntimeKind> 
export type ValidRuntimes = Set<RuntimeKind> 
export type ParsedRuntimeConfig = {
  valid: ValidRuntimes,
  default: DefaultRuntimes
}

// List of file extensions for runtimes. This hardcoded list used to be present
// in the extensions field of the runtimes.json document.
const FileExtensionRuntimes: Record<RuntimeFileExtension, RuntimeKind> = {
  'rs': 'rust',
  'js': 'nodejs',
  'py': 'python',
  'ts': 'typescript',
  'java': 'java',
  'jar': 'java',
  'go': 'go',
  'swift': 'swift',
  'php': 'php',
  'rb': 'ruby',
}

// File extensions which imply binary data
const BinaryFileExtensions: Set<RuntimeFileExtension> = new Set<RuntimeFileExtension>(['zip', 'jar'])

// Send HTTP request to platform endpoint for runtimes configuration
export async function fromPlatform(httpClient: AxiosInstance, platformUrl: string): Promise<Record<string, unknown>> {
  const url  = `${platformUrl}${API_ENDPOINT}`
  try {
    const { data } = await httpClient.get(url)
    return data
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

// Merge inner arrays [[a], [b], [c]] => [a, b, c]
const flatten = <T> (arr: (T[])[]): T[] => arr.reduce((a, k) => a.concat(k), []) 

// Return set of valid runtimes from the runtimes configuration.
// For each runtime image found, return the `kind` property on the image.
// If the image is the default, return additional default kind value: ${label:default}
export function parseValidRuntimes(config: RuntimesConfig): Set<RuntimeKind> {
  const extractValidKinds = (label: RuntimeLabel, r: Runtime): RuntimeKind[] => {
    return (r.default === true) ? [r.kind, `${label}:default`] : [r.kind]
  }

  const runtimesToKinds = ([label, images]: [RuntimeLabel, Runtime[]]): RuntimeKind[] => {
    return flatten<RuntimeKind>(images.map(ri => extractValidKinds(label, ri)))
  }

  const kindLabels = flatten<RuntimeKind>(Object.entries(config).map(runtimesToKinds))

  return new Set<RuntimeKind>(kindLabels)
}

// Return a lookup of runtime labels to the default kind image from the runtimes config.
export function parseDefaultRuntimes(config: RuntimesConfig): DefaultRuntimes {
  const runtimesToDefaults = ([label, images]: [RuntimeLabel, Runtime[]]): DefaultRuntimes => {
    const ri = images.find(ri => ri.default)
    return ri ? {[label]: ri.kind} : {}
  }

  return Object.assign({} as DefaultRuntimes, ...Object.entries(config).map(runtimesToDefaults))
}

// Compute the runtime from the file extension.
export function runtimeForFileExtension(fileExtension: RuntimeFileExtension): RuntimeKind | undefined {
  const runtime = FileExtensionRuntimes[fileExtension]
  return runtime ? `${runtime}:default` : runtime
}

// Does file extension imply binary data?
export function isBinaryFileExtension(fileExtension: RuntimeFileExtension): boolean {
  return BinaryFileExtensions.has(fileExtension)
}

// Compute the expected file extension from a runtime name. 
// Runtime returned should match the option for whether file extension refers to binary data
export function fileExtensionForRuntime(runtime: RuntimeKind, isBinaryExtension: boolean): RuntimeFileExtension {
  const isSameRuntime = (r: string): boolean => runtime.startsWith(r)
  const isValidRuntime = Object.values(FileExtensionRuntimes).some(isSameRuntime)
  if (!isValidRuntime) throw new Error(`Invalid runtime ${runtime} encountered`)

  const extFromEntry = <T>(entry?: T[]): T | undefined => Array.isArray(entry) ? entry[0] : entry
  const extRuntimes = Object.entries(FileExtensionRuntimes).filter(([ext]: string[]) => BinaryFileExtensions.has(ext) === isBinaryExtension)
  return extFromEntry(extRuntimes.find(([_, r]) => isSameRuntime(r)))
}

// Compute a runtime kind from the 'mid string' of a file name of the form name.runtime.zip
export function runtimeForZipMid(runtimes: Set<RuntimeKind>, mid: string): RuntimeKind {
  const runtime = mid.includes('-') ? mid.replace('-', ':') : `${mid}:default`
  return runtimes.has(runtime) ? runtime : undefined
}

// Return default kind for runtime label - if explicit version isn't used.
export function canonicalRuntime(defaults: Record<RuntimeLabel, RuntimeKind>, runtime: RuntimeKind) {
  if (runtime.endsWith(':default')) {
    const [label] = runtime.split(':')
    return defaults[label]
  }
  return runtime
}

// Custom type guard to ensure JSON response is in the correct format
function isValidRuntimesJson(src: Record<string, unknown>): src is RuntimesConfig {
  return Object.values(src).every(v => {
    Array.isArray(v) && v.every(k => k.hasOwnProperty('kind'))
  })
}

// Load runtimes JSON configuration file from platform endpoint
export async function load(apihost: string): Promise<ParsedRuntimeConfig> {
  const result = await fromPlatform(axios, apihost)
  if (!isValidRuntimesJson(result)) {
    throw new Error(`Invalid runtime JSON received from platform API: ${apihost}`)
  }
  const valid = parseValidRuntimes(result)
  const d = parseDefaultRuntimes(result)
  return { valid, default: d }
}
