import * as yaml from 'js-yaml';
import { makeConfigFromActionSpec } from './finder-builder';
import { ActionSpec, DeployStructure, Flags } from './deploy-struct';

describe('makeConfigFromActionSpec', () => {
  const flags: Flags = {
    verboseBuild: false,
    verboseZip: false,
    incremental: false,
    yarn: false,
    env: undefined,
    buildEnv: undefined,
    include: undefined,
    exclude: undefined,
    remoteBuild: true,
    json: false,
    auth: undefined as unknown as string,
    apiHost: undefined as unknown as string,
    insecure: false,
    noTriggers: false
  };

  const action: ActionSpec = {
    name: 'hello',
    runtime: 'nodejs:18'
  };

  const project: DeployStructure = {
    targetNamespace: 'ns1',
    credentials: {
      namespace: 'ns1',
      ow: {
        apihost: 'https://functions.example.com',
        api_key: 'namespace-ow-key'
      },
      do_token: 'do_token_must_not_appear_in_remote_slice'
    },
    flags,
    packages: [
      {
        name: 'sample',
        actions: [action]
      }
    ]
  };

  it('omits do_token from remote slice credentials', () => {
    const slice = makeConfigFromActionSpec(action, project, 'sample');
    expect(slice.slice).toBe(true);
    expect(slice.credentials).toEqual({
      namespace: 'ns1',
      ow: {
        apihost: 'https://functions.example.com',
        api_key: 'namespace-ow-key'
      }
    });
    expect(slice.credentials && 'do_token' in slice.credentials).toBe(false);
  });

  it('does not put do_token into YAML for remote project.yml', () => {
    const slice = makeConfigFromActionSpec(action, project, 'sample');
    const dumped = yaml.safeDump(slice);
    expect(dumped).not.toMatch(/do_token/);
    expect(dumped).not.toMatch(/do_token_must_not_appear_in_remote_slice/);
    expect(dumped).toMatch(/namespace-ow-key/);
  });
});
