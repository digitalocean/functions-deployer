import {
  decryptProjectConfig,
  encryptProjectConfig,
  loadProjectConfig,
  validateTriggers
} from './util';
const crypto = require('crypto'); // eslint-disable-line @typescript-eslint/no-var-requires

describe('loadProjectConfig', () => {
  const yml = `
      slice: true,
      packages:
        - name: test-encryption
          functions:
            - name: hello1
              runtime: nodejs:18
      credentials:
          do_token: abc-123
          ow: 
            api_key: 123-456
            apihost: https://test.com
    `;
  const { config, key } = encryptProjectConfig(yml);

  it('should decrypt config file when an encryption key is available', async () => {
    process.env.ENCRYPTION_KEY = key;
    const mockReader = {
      readFileContents: jest
        .fn()
        .mockImplementationOnce(() => Promise.resolve(config))
    };

    try {
      const res = await loadProjectConfig(
        'slice:configFile',
        'envPath',
        'buildEnvPath',
        'slice:filePath',
        mockReader as any,
        {
          warn: jest.fn(),
          progress: jest.fn()
        }
      );
      expect(res.credentials).toEqual({
        do_token: 'abc-123',
        ow: {
          api_key: '123-456',
          apihost: 'https://test.com'
        }
      });
    } catch (error) {
      expect(error).toBeUndefined();
    }
  });

  it('should NOT decrypt config file when an encryption key is unavailable', async () => {
    process.env.ENCRYPTION_KEY = undefined;
    const mockReader = {
      readFileContents: jest
        .fn()
        .mockImplementationOnce(() => Promise.resolve(config))
    };

    try {
      const res = await loadProjectConfig(
        'configFile',
        'envPath',
        'buildEnvPath',
        'filePath',
        mockReader as any,
        {
          warn: jest.fn(),
          progress: jest.fn()
        }
      );
      expect(res).toBeUndefined();
    } catch (error) {
      expect(error).not.toBeUndefined();
    }
  });
});

describe('validateTriggers', () => {
  it('should be an array of triggers', () => {
    expect(validateTriggers({})).toBe("a 'triggers' clause must be an array");
    expect(validateTriggers([])).toBeUndefined();
  });

  it('should has a valid trigger type', () => {
    let res = validateTriggers([
      {
        name: 'trigger',
        type: 'no-valid'
      }
    ]);
    expect(res).toEqual(`the trigger 'type' field must be 'SCHEDULED'`);

    res = validateTriggers([
      {
        name: 'trigger',
        type: 'scheduled',
        scheduledDetails: {
          cron: '* * * * * '
        }
      }
    ]);
    expect(res).toBeUndefined();
  });

  it('should not contain unsupported keys', () => {
    const res = validateTriggers([
      {
        name: 'trigger',
        type: 'scheduled',
        invalid: 'value'
      }
    ]);
    expect(res).toEqual(
      `Invalid key 'invalid' found in 'triggers' clause in project.yml`
    );
  });

  it('should have a valid SCHEDULED details', () => {
    let res = validateTriggers([
      {
        name: 'trigger',
        type: 'scheduled',
        scheduledDetails: {
          cron: 'foo'
        }
      }
    ]);
    expect(res).toEqual(
      `the cron expression 'foo' is not valid crontab syntax`
    );

    res = validateTriggers([
      {
        name: 'trigger',
        type: 'scheduled',
        scheduledDetails: {
          cron: '* * * * *',
          body: 'string body'
        }
      }
    ]);
    expect(res).toEqual(
      `the 'body' member of scheduledDetails must be a dictionary`
    );

    res = validateTriggers([
      {
        name: 'trigger',
        type: 'scheduled',
        scheduledDetails: {
          cron: '* * * * *',
          body: {
            foo: 'bar'
          }
        }
      }
    ]);
    expect(res).toBeUndefined();
  });
});

describe('encryptProjectConfig with AES-GCM', () => {
  const yml = `
    packages:
      - name: test-triggers
        functions:
          - name: hello1
            web: false
  `;

  const mockKey =
    'cd7a175002a713696fef83b30e93638388eed520eec1cbddec8f51633db3dcb7';
  const mockIv = '1a2b3c4d5e6f708190a0b0c0';

  it('should encrypt the project yaml data with colon-separated format', () => {
    const mockRandomBytes = jest.spyOn(crypto, 'randomBytes');

    mockRandomBytes
      .mockImplementationOnce(() => Buffer.from(mockKey, 'hex'))
      .mockImplementationOnce(() => Buffer.from(mockIv, 'hex'));

    const { config, key } = encryptProjectConfig(yml);
    expect(key).toBe(mockKey);
    const parts = config.split(':');
    expect(parts.length).toBe(3);

    const [ivHex, authTagHex, encryptedHex] = parts;

    expect(ivHex).toBe(mockIv);
    expect(authTagHex.length).toBe(32);
    expect(encryptedHex.length).toBeGreaterThan(0);
  });

  it('should decrypt the project yaml data given the correct key', () => {
    const mockRandomBytes = jest.spyOn(crypto, 'randomBytes');

    mockRandomBytes
      .mockImplementationOnce(() => Buffer.from(mockKey, 'hex'))
      .mockImplementationOnce(() => Buffer.from(mockIv, 'hex'));

    const { config, key } = encryptProjectConfig(yml);

    const decrypted = decryptProjectConfig(config, key);
    expect(decrypted).toBe(yml);
  });
});
