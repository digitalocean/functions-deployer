import { fromPlatform, parseValidRuntimes, API_ENDPOINT, RuntimesConfig, runtimeForFileExtension, isBinaryFileExtension, fileExtensionForRuntime, runtimeForZipMid, canonicalRuntime, parseDefaultRuntimes } from '../../src/runtimes'
import axios from 'axios'
import { mocked } from 'ts-jest/utils'

jest.mock('axios')

describe('test retrieving runtimes configuration from platform', () => {
  test('should return JSON runtime configuration from platform endpoint with valid response', async () => {
    const data = {
      runtimes: {
        nodejs: [{
          "attached": true,
          "default": true,
          "deprecated": false,
          "image": "nimbella/action-nodejs-v14:latest",
          "kind": "nodejs:14",
          "requireMain": false
        }]
      }
    }
    const response = {
      data,
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {},
      request: {}
    }

    const platformUrl = 'https://some-platform-host.com'

    const httpClient = async (url: string): Promise<Record<string, any>> => {
      expect(url).toEqual(`${platformUrl}${API_ENDPOINT}`)
      return response
    }

    const mockedAxios = mocked(axios, true)
    mockedAxios.get.mockImplementation(httpClient)

    await expect(fromPlatform(mockedAxios, platformUrl)).resolves.toEqual(data)
  })

  test('should throw errors from HTTP responses > 2XX', async () => {
    const response = {
      status: 500,
      statusText: 'NOT OK'
    }

    const platformUrl = 'https://some-platform-host.com'

    const httpClient = async (): Promise<Record<string, any>> => {
      throw { response }
    }

    const mockedAxios = mocked(axios, true)
    mockedAxios.get.mockImplementation(httpClient)

    const matcher = new RegExp(`${platformUrl}.*${response.status}.*${response.statusText}`);
    await expect(fromPlatform(mockedAxios, platformUrl)).rejects.toThrow(matcher)
  })
  test('should throw errors from HTTP responses > 2XX', async () => {
    const response = {
      status: 500,
      statusText: 'NOT OK'
    }

    const platformUrl = 'https://some-platform-host.com'

    const httpClient = async (): Promise<Record<string, any>> => {
      throw { response }
    }

    const mockedAxios = mocked(axios, true)
    mockedAxios.get.mockImplementation(httpClient)

    const matcher = new RegExp(`${platformUrl}.*${response.status}.*${response.statusText}`);
    await expect(fromPlatform(mockedAxios, platformUrl)).rejects.toThrow(matcher)
  })

  test('should throw errors from HTTP responses > 2XX', async () => {
    const response = {
      status: 500,
      statusText: 'NOT OK'
    }

    const platformUrl = 'https://some-platform-host.com'

    const httpClient = async (): Promise<Record<string, any>> => {
      throw { response }
    }

    const mockedAxios = mocked(axios, true)
    mockedAxios.get.mockImplementation(httpClient)

    const matcher = new RegExp(`${platformUrl}.*${response.status}.*${response.statusText}`);
    await expect(fromPlatform(mockedAxios, platformUrl)).rejects.toThrow(matcher)
  })
  test('should throw errors when HTTP request failed to send', async () => {
    const platformUrl = 'https://some-platform-host.com'
    const httpClient = async (): Promise<Record<string, any>> => {
      throw { request: {} }
    }

    const mockedAxios = mocked(axios, true)
    mockedAxios.get.mockImplementation(httpClient)

    await expect(fromPlatform(mockedAxios, platformUrl)).rejects.toThrow(`http request failed: GET ${platformUrl}`)
  })
  test('should throw errors when unknown exception occurs', async () => {
    const platformUrl = 'https://some-platform-host.com'
    const message = 'error message'
    const httpClient = async (): Promise<Record<string, any>> => {
      throw new Error(message)
    }

    const mockedAxios = mocked(axios, true)
    mockedAxios.get.mockImplementation(httpClient)

    await expect(fromPlatform(mockedAxios, platformUrl)).rejects.toThrow(message)
  })
})

describe('test parsing valid runtimes', () => {
  test('should return set of runtime names from platform runtimes JSON', () => {
    const runtimes: RuntimesConfig = {
      nodejs: [
        { "kind": "nodejs:10" },
        { "kind": "nodejs:14" },
      ],
      python: [
        { "kind": "python:2" },
        { "kind": "python:3" },
      ],
      java: [
        { "kind": "java:8" }
      ]
    }

    const valid_runtimes = parseValidRuntimes(runtimes)
    expect(valid_runtimes).toEqual(new Set([].concat(...Object.values(runtimes)).map(r => r.kind)))
  })

  test('should include default values in set extracted from platform runtimes JSON', () => {
    const runtimes: RuntimesConfig = {
      nodejs: [
        { "kind": "nodejs:10" },
        { "kind": "nodejs:14", default: true },
      ],
      python: [
        { "kind": "python:2" },
        { "kind": "python:3", default: true },
      ],
      java: [
        { "kind": "java:8" }
      ]
    }

    const valid_runtimes = parseValidRuntimes(runtimes)
    const all_kinds = [].concat(...Object.values(runtimes))
    const normal_runtimes = all_kinds.map(r => r.kind)
    const default_runtimes = all_kinds.filter(k => k.default).map(k => `${k.kind.split(':')[0]}:default`)
    expect(valid_runtimes).toEqual(new Set([...normal_runtimes, ...default_runtimes]))
  })
})

describe('test parsing default runtimes lookup', () => {
  test('should create map of runtimes from default kinds in runtime configuration', () => {
    const config: RuntimesConfig = {
      nodejs: [
        { "kind": "nodejs:10" },
        { "kind": "nodejs:14", default: true },
      ],
      python: [
        { "kind": "python:2" },
        { "kind": "python:3", default: true },
      ],
      java: [
        { "kind": "java:8" }
      ]
    }

    const defaultRuntimes = parseDefaultRuntimes(config)
    expect(defaultRuntimes).toEqual({
      'nodejs': 'nodejs:14', 
      'python': 'python:3', 
    })
  })
})

describe('test determing runtime for an extension', () => {
  test('should return runtimes for hardcoded extensions', () => {
    const known_runtimes = {
      'rs': 'rust:default',
      'js': 'nodejs:default',
      'py': 'python:default',
      'ts': 'typescript:default',
      'java': 'java:default',
      'jar': 'java:default',
      'go': 'go:default',
      'swift': 'swift:default',
      'php': 'php:default',
      'rb': 'ruby:default',
    }

    for (let [extension, runtime] of Object.entries(known_runtimes)) {
      expect(runtimeForFileExtension(extension)).toEqual(runtime)
    }
  })

  test('should return undefined for unknown runtime', () => {
    expect(runtimeForFileExtension('unknown')).toEqual(undefined)
  })
})

describe('test does file extension imply binary data', () => {
  test('should return true for binary file extensions', () => {
    const binary_extensions = [ 'jar', 'zip' ]

    for (let ext of binary_extensions) {
      expect(isBinaryFileExtension(ext)).toEqual(true)
    }
  })

  test('should return false for non-binary file extensions', () => {
    const nonbinary_extensions = [
      'rs', 'js', 'py', 'ts', 'java', 'go', 'swift', 'php', 'rb', 'unknown'
    ]

    for (let ext of nonbinary_extensions) {
      expect(isBinaryFileExtension(ext)).toEqual(false)
    }
  })
})

describe('test determing extension from runtime', () => {
  test('should return extensions for known non-binary runtimes (version & default)', () => {
    const known_runtimes = {
      'rust': 'rs',
      'nodejs': 'js',
      'python': 'py',
      'typescript': 'ts',
      'java': 'java',
      'go': 'go',
      'swift': 'swift',
      'php': 'php',
      'ruby': 'rb'
    }
    for (let [runtime, extension] of Object.entries(known_runtimes)) {
      expect(fileExtensionForRuntime(`${runtime}:10`, false)).toEqual(extension)
      expect(fileExtensionForRuntime(`${runtime}:default`, false)).toEqual(extension)
    }
  }) 
  test('should return extensions for known binary runtimes (version & default)', () => {
    const known_runtimes = {
      'java': 'jar'
    }
    for (let [runtime, extension] of Object.entries(known_runtimes)) {
      expect(fileExtensionForRuntime(`${runtime}:10`, true)).toEqual(extension)
      expect(fileExtensionForRuntime(`${runtime}:default`, true)).toEqual(extension)
    }
  }) 

  test('should return undefined for unknown runtimes', () => {
    expect(() => fileExtensionForRuntime('unknown:10', false)).toThrow(`Invalid runtime unknown:10 encountered`)
    expect(() => fileExtensionForRuntime('unknown:default', false)).toThrow(`Invalid runtime unknown:default encountered`)

    expect(() => fileExtensionForRuntime('unknown:10', true)).toThrow(`Invalid runtime unknown:10 encountered`)

    expect(() => fileExtensionForRuntime('unknown:default', true)).toThrow(`Invalid runtime unknown:default encountered`)
  })
  test('should return undefined for incorrect binary runtimes', () => {
    expect(fileExtensionForRuntime(`nodejs:default`, true)).toEqual(undefined)
  })
}) 

describe('test determing runtime from mid string', () => {
  test('should return undefined for unknown runtimes', () => {
    const runtimes = new Set<string>()
    expect(runtimeForZipMid(runtimes, `runtime`)).toEqual(undefined)
    expect(runtimeForZipMid(runtimes, `runtime-10`)).toEqual(undefined)
  })
  test('should return runtimes for known runtimes', () => {
    const runtimes = new Set(['runtime:default', 'runtime:10'])
    expect(runtimeForZipMid(runtimes, `runtime`)).toEqual('runtime:default')
    expect(runtimeForZipMid(runtimes, `runtime-10`)).toEqual('runtime:10')
  })
})

describe('test determining canonical runtime', () => {
  test('should return default runtime without explicit version', () => {
    const defaults = { 'runtime': 'runtime:10' }
    expect(canonicalRuntime(defaults, 'runtime:default')).toEqual('runtime:10')
  })
  test('should runtime with explicit version', () => {
    const defaults = { 'runtime': 'runtime:12' }
    expect(canonicalRuntime(defaults, 'runtime:10')).toEqual('runtime:10')
  })
  test('should return undefined for non-existing default runtime', () => {
    const defaults = { }
    expect(canonicalRuntime(defaults, 'runtime:default')).toEqual(undefined)
  })
})
