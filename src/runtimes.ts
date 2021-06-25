import type { AxiosInstance } from 'axios'

export const API_ENDPOINT = '/api/v1'

// Custom types for runtimes.json configuration parameters
type RuntimeLabel = string
type RuntimeKind = string
type RuntimeFileExtension = string
type isBinaryFile = boolean

export type RuntimeExtension = Record<RuntimeFileExtension, isBinaryFile> 

export interface Runtime {
  kind: RuntimeKind 
  default?: boolean
}

export type RuntimesConfig = Record<RuntimeLabel, Runtime[]> 

// List of file extensions for runtimes. This hardcoded list used to be present
// in the extensions field of the runtimes.json document.
const FileExtensionRuntimes: Record<RuntimeFileExtension, RuntimeKind> = {
  '.rs': 'rust',
  '.js': 'nodejs',
  '.py': 'python',
  '.ts': 'typescript',
  '.java': 'java',
  '.jar': 'java',
  '.go': 'go',
  '.swift': 'swift',
  '.php': 'swift',
  '.rb': 'swift',
}

// Send HTTP request to platform endpoint for runtimes configuration
export async function fromPlatform(httpClient: AxiosInstance, platformUrl: string) {
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

export function runtimeForFileExtension(fileExtension: RuntimeFileExtension): RuntimeKind | undefined {
  return FileExtensionRuntimes[fileExtension]
}

// TODO: Runtime to extensions
// TODO: Runtime to binary extensions
// Re-factor / remove all the code in runtimes.json
