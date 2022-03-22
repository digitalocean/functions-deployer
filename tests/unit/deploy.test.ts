import { ActionSpec } from '../../src/deploy-struct'
import { calculateActionExec } from '../../src/deploy'
import { checkIncludeItems } from '../../src/finder-builder'

describe('test calculating action runtime kind property', () => {
  test('should return runtime property as kind', () => {
    const as: ActionSpec = {
      name: 'test-action',
      main: 'main',
      binary: true,
      runtime: 'test-runtime'
    }
    const code = 'this is the action code'
    expect(calculateActionExec(as, code)).toStrictEqual({ code, binary: as.binary, main: as.main, kind: as.runtime })
  })
  test('should return blackbox kind from docker property', () => {
    const as: ActionSpec = {
      name: 'test-docker-action',
      main: 'main',
      binary: true,
      docker: 'docker-image'
    }
    const code = 'this is the action code'
    expect(calculateActionExec(as, code)).toStrictEqual({ code, binary: as.binary, main: as.main, image: as.docker, kind: 'blackbox' })
  })
  test('should ignore explicit runtime with docker property', () => {
    const as: ActionSpec = {
      name: 'test-docker-action',
      main: 'main',
      binary: true,
      docker: 'docker-image',
      runtime: 'another-runtime'
    }
    const code = 'this is the action code'
    expect(calculateActionExec(as, code)).toStrictEqual({ code, binary: as.binary, main: as.main, image: as.docker, kind: 'blackbox' })
  })
})

describe('test checking of .include files', () => {
  test('Should accept legal .include for action build', () => {
    const items = [
      'node_modules',
      'index.js',
      '../../../lib/shared'
    ]
    expect(checkIncludeItems(items, false)).toStrictEqual("")
  })  
  test('Should accept legal .include for web build', () => {
    const items = [
      'build',
      '../lib/shared'
    ]
    expect(checkIncludeItems(items, true)).toStrictEqual("")
  })  
  test('Should reject absolute paths', () => {
    const items = [
      'node_modules',
      'index.js',
      '/usr/share/stuff'
    ]
    expect(checkIncludeItems(items, false)).toStrictEqual(`Absolute paths are prohibited in an '.include' file`)
  })  
  test('Should reject illegal .. usage', () => {
    const items = [
      '../other/things'
    ]
    expect(checkIncludeItems(items, false)).toStrictEqual(`Illegal use of '..' in an '.include' file`)
  })
  test('Should reject .. usage in web build that would only be legal in action build', () => {
    const items = [
      'node_modules',
      'index.js',
      '../../../lib/shared'
    ]
    expect(checkIncludeItems(items, true)).toStrictEqual(`Illegal use of '..' in an '.include' file`)    
})
})
