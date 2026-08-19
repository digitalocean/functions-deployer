import { makeConfigFromActionSpec } from './finder-builder';
import { ActionSpec, DeployStructure, TriggerType } from './deploy-struct';

describe('makeConfigFromActionSpec', () => {
  const action: ActionSpec = {
    name: 'bar',
    package: 'foo',
    runtime: 'python:3.11',
    file: 'packages/foo/bar',
    limits: { timeout: 600000, memory: 1024 },
    triggers: [
      {
        name: 'trigger-daily',
        type: TriggerType.SCHEDULED,
        scheduledDetails: { cron: '* * * * *', body: { spreadsheet: 'foo' } }
      }
    ]
  };

  const spec = {
    flags: { remoteBuild: true } as any,
    packages: [{ name: 'foo', actions: [action] }]
  } as DeployStructure;

  it('carries the triggers of the action into the sliced project', () => {
    const sliced = makeConfigFromActionSpec(action, spec, 'foo');
    expect(sliced.packages[0].actions[0].triggers).toEqual(action.triggers);
  });
});
