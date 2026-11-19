import { omitAccountTokenFromRemoteSlice } from './credentials';
import { Credentials } from './deploy-struct';
import * as yaml from 'js-yaml';

describe('omitAccountTokenFromRemoteSlice', () => {
  const full: Credentials = {
    namespace: 'ns1',
    ow: {
      apihost: 'https://functions.example.com',
      api_key: 'namespace-ow-key'
    },
    do_token: 'do_token_must_not_appear_in_remote_slice'
  };

  it('returns undefined when credentials are undefined', () => {
    expect(omitAccountTokenFromRemoteSlice(undefined)).toBeUndefined();
  });

  it('omits do_token and keeps namespace OpenWhisk credentials', () => {
    const safe = omitAccountTokenFromRemoteSlice(full);
    expect(safe).toEqual({
      namespace: 'ns1',
      ow: {
        apihost: 'https://functions.example.com',
        api_key: 'namespace-ow-key'
      }
    });
    expect(safe && 'do_token' in safe).toBe(false);
  });

  it('does not mutate the original credentials object', () => {
    omitAccountTokenFromRemoteSlice(full);
    expect(full.do_token).toBe('do_token_must_not_appear_in_remote_slice');
  });

  it('does not put do_token into YAML used for remote project.yml', () => {
    const safe = omitAccountTokenFromRemoteSlice(full);
    const dumped = yaml.safeDump({ credentials: safe, slice: true });
    expect(dumped).not.toMatch(/do_token/);
    expect(dumped).not.toMatch(/do_token_must_not_appear_in_remote_slice/);
    expect(dumped).toMatch(/namespace-ow-key/);
  });
});
