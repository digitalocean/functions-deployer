import { validateTriggers } from './util';

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
