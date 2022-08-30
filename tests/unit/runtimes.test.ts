import { fromPlatform, API_ENDPOINT, RuntimesConfig, runtimeForFileExtension, isBinaryFileExtension, fileExtensionForRuntime, runtimeForZipMid, canonicalRuntime, isValidRuntime, defaultRuntime } from '../../src/runtimes'
import axios from 'axios'
import { mocked } from 'jest-mock'

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

    await expect(fromPlatform(mockedAxios, platformUrl)).resolves.toEqual(data.runtimes)
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

describe('test checking valid runtimes', () => {
  test('should find valid runtimes with explicit version', () => {
    const runtimes: RuntimesConfig = {
      nodejs: [
        { "kind": "nodejs:10" },
        { "kind": "cloudjs:10" }
      ]
    }
    expect(isValidRuntime(runtimes, 'nodejs:10')).toEqual(true)
    expect(isValidRuntime(runtimes, 'cloudjs:10')).toEqual(true)
  })

  test('should find valid runtimes with default version', () => {
    const runtimes: RuntimesConfig = {
      nodejs: [{ "kind": "nodejs:10", default: true }],
      python: [{ "kind": "python:10", default: true }]
    }
    expect(isValidRuntime(runtimes, 'nodejs:default')).toEqual(true)
    expect(isValidRuntime(runtimes, 'python:default')).toEqual(true)
  })

  test('should find non-valid runtimes with missing default version', () => {
    const runtimes: RuntimesConfig = {
      nodejs: [{ "kind": "nodejs:10" }]
    }
    expect(isValidRuntime(runtimes, 'nodejs:default')).toEqual(false)
  })

  test('should find non-valid runtimes with explicit version', () => {
    const runtimes: RuntimesConfig = {
      nodejs: [{ "kind": "nodejs:10" }]
    }
    expect(isValidRuntime(runtimes, 'nodejs:14')).toEqual(false)
    expect(isValidRuntime(runtimes, 'python:3')).toEqual(false)
  })
})

describe('test finding default runtimes', () => {
  test('should find valid runtimes with explicit version', () => {
    const runtimes: RuntimesConfig = {
      nodejs: [{ "kind": "nodejs:10", default: true }]
    }
    expect(defaultRuntime(runtimes, 'nodejs')).toEqual('nodejs:10')
  })
  test('should ignore valid runtimes', () => {
    const runtimes: RuntimesConfig = {
      nodejs: [{ "kind": "nodejs:10" }]
    }
    expect(defaultRuntime(runtimes, 'nodejs')).toEqual(undefined)
    expect(defaultRuntime(runtimes, 'python')).toEqual(undefined)
  })
})

describe('test determing runtime for an extension', () => {
  test('should return runtimes for hardcoded extensions', () => {
    const known_runtimes = {
//      'rs': 'rust:default',
      'js': 'nodejs:default',
      'py': 'python:default',
      'ts': 'nodejs:default',
//      'java': 'java:default',
//      'jar': 'java:default',
      'go': 'go:default',
//      'swift': 'swift:default',
      'php': 'php:default',
//      'rb': 'ruby:default',
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
    const binary_extensions = ['jar', 'zip']

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

describe('test determining extension from runtime', () => {
  test('should return extensions for known non-binary runtimes (version & default)', () => {
    const known_runtimes = {
      'go': ['go'],
//      'java': ['java', 'jar'],
      'nodejs': ['js', 'ts'],
      'php': ['php'],
      'python': ['py'],
//      'ruby': ['rb'],
//      'rust': ['rs'],
//      'swift': ['swift'],
//      'deno': ['ts', 'js'],
//      'dotnet': ['cs', 'vb']
    }
    for (let [runtime, extension] of Object.entries(known_runtimes)) {
      expect(fileExtensionForRuntime(runtime, false)).toEqual(extension[0])
    }
  })
  /*
  test('should return extensions for known binary runtimes (version & default)', () => {
    const known_runtimes = {
      'java': ['java', 'jar']
    }
    for (let [runtime, extension] of Object.entries(known_runtimes)) {
      expect(fileExtensionForRuntime(runtime, true)).toEqual(extension[1])
    }
  })
  */

  test('should return undefined for unknown runtimes', () => {
    expect(() => fileExtensionForRuntime('unknown:10', false)).toThrow(`Invalid runtime unknown:10 encountered`)
    expect(() => fileExtensionForRuntime('unknown:default', false)).toThrow(`Invalid runtime unknown:default encountered`)

    expect(() => fileExtensionForRuntime('unknown:10', true)).toThrow(`Invalid runtime unknown:10 encountered`)

    expect(() => fileExtensionForRuntime('unknown:default', true)).toThrow(`Invalid runtime unknown:default encountered`)
  })
  test('should return undefined for incorrect binary runtimes', () => {
    expect(fileExtensionForRuntime(`nodejs`, true)).toEqual(undefined)
  })
})

describe('test determining runtime from mid string', () => {
  test('should return undefined for unknown runtimes', () => {
    const runtimes = {}
    expect(runtimeForZipMid(runtimes, `runtime`)).toEqual(undefined)
    expect(runtimeForZipMid(runtimes, `runtime-10`)).toEqual(undefined)
  })
  test('should return runtimes for known runtimes', () => {
    const runtimes = {
      nodejs: [{
        "default": true,
        "kind": "nodejs:14"
      }]
    }

    expect(runtimeForZipMid(runtimes, `nodejs`)).toEqual('nodejs:default')
    expect(runtimeForZipMid(runtimes, `nodejs-14`)).toEqual('nodejs:14')
  })
})

describe('test determining canonical runtime', () => {
  test('should return default runtime without explicit version', () => {
    const runtimes = {
      nodejs: [{
        "default": true,
        "kind": "nodejs:14"
      }]
    }
    expect(canonicalRuntime(runtimes, 'nodejs:default')).toEqual('nodejs:14')
  })
  test('should runtime with explicit version', () => {
    const runtimes = {}
    expect(canonicalRuntime(runtimes, 'runtime:10')).toEqual('runtime:10')
  })
  test('should return undefined for non-existing default runtime', () => {
    const runtimes = {}
    expect(canonicalRuntime(runtimes, 'runtime:default')).toEqual(undefined)
  })
})
