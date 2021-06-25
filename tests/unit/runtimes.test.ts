import { fromPlatform, parseValidRuntimes, API_ENDPOINT, RuntimesConfig } from '../../src/runtimes'
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

describe('test determing runtime for an extension', () => {
  test('should return runtimes for hardcoded extensions', async () => {
  })

  test('should return undefined for unknown runtime', async () => {
  })
})
