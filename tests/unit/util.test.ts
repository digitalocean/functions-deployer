import { validateDeployConfig, loadProjectConfig } from "../../src/util";
import { ProjectReader } from "../../src/deploy-struct";
import { ParsedRuntimeConfig } from "../../src/runtimes";

describe('test validation of deploy configuration', () => {
  test('should validate empty config', () => {
    const config = {}
    expect(validateDeployConfig(config, {} as ParsedRuntimeConfig)).toBe(undefined)
  })

  test('should validate config with docker action', () => {
    const action = { name: 'hello-docker', main: 'main', docker: 'python:default' }
    const packages = [{ name: 'default', actions: [action] }]
    const config = { packages }
    expect(validateDeployConfig(config, {} as ParsedRuntimeConfig)).toBe(undefined)
  })
  test('should return error for config with invalid docker property', () => {
    const invalidProps = [{}, [], 1, true]

    const action = { name: 'hello-docker', main: 'main', docker: null }
    const packages = [{ name: 'default', actions: [action] }]
    const config = { packages }

    invalidProps.forEach(p => {
      action.docker = p
      expect(validateDeployConfig(config, {} as ParsedRuntimeConfig)).toBe("'docker' member of an 'action' must be a string")
    })
  })
})

describe('test validation of loading project configuration', () => {
  test('should return error with invalid config', async () => {
    const reader = {
      readFileContents: async function () {
        return Promise.resolve('')
      }
    }
    const result = await loadProjectConfig('project.yml', '', '', (reader as unknown) as ProjectReader, null, {} as ParsedRuntimeConfig)
    expect(result.error.message).toBe(`Invalid project configuration file (project.yml): Cannot read property 'slice' of undefined`)
  })
  test('should parse minimal YAML file', async () => {
    const reader = {
      readFileContents: async function () {
        return Promise.resolve('packages:')
      }
    }
    const result = await loadProjectConfig('project.yml', '', '', (reader as unknown) as ProjectReader, null, {} as ParsedRuntimeConfig)
    expect(result).toEqual({packages: null})
  })
})
