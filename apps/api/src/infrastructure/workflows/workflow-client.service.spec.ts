import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { WorkflowClientService } from './workflow-client.service';

const start = jest.fn();
const signalWithStart = jest.fn();
const signal = jest.fn();
const close = jest.fn().mockResolvedValue(undefined);
const connect = jest.fn();

jest.mock('@temporalio/client', () => {
  const actual = jest.requireActual('@temporalio/client');
  return {
    ...actual,
    Connection: { connect: (...args: unknown[]) => connect(...args) },
    Client: jest.fn().mockImplementation(() => ({
      workflow: {
        start,
        signalWithStart,
        getHandle: () => ({ signal, describe: jest.fn() }),
      },
    })),
  };
});

const input = {
  workflowType: 'sampleDelayedEchoWorkflow',
  workflowId: 'sample:1',
  taskQueue: 'nuts-default',
  args: [{ message: 'hi', delayMs: 1 }],
};

describe('WorkflowClientService', () => {
  const original = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    connect.mockResolvedValue({ close });
    start.mockResolvedValue({
      workflowId: 'sample:1',
      firstExecutionRunId: 'run-1',
    });
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it('is a logged no-op while disabled and never connects', async () => {
    delete process.env.TEMPORAL_ENABLED;
    const service = new WorkflowClientService();
    await expect(service.startWorkflow(input)).resolves.toEqual({
      started: false,
      workflowId: 'sample:1',
      reason: 'disabled',
    });
    await service.signal('sample:1', 'x');
    await service.signalWithStart({ ...input, signal: 'x' });
    expect(connect).not.toHaveBeenCalled();
  });

  it('starts a workflow with the business key as its id', async () => {
    process.env.TEMPORAL_ENABLED = 'true';
    const service = new WorkflowClientService();
    const result = await service.startWorkflow(input);
    expect(result).toEqual({
      started: true,
      workflowId: 'sample:1',
      runId: 'run-1',
    });
    expect(start).toHaveBeenCalledWith('sampleDelayedEchoWorkflow', {
      workflowId: 'sample:1',
      taskQueue: 'nuts-default',
      args: input.args,
    });
  });

  it('treats an already-started workflow as a successful no-op', async () => {
    process.env.TEMPORAL_ENABLED = 'true';
    start.mockRejectedValue(
      new WorkflowExecutionAlreadyStartedError(
        'exists',
        'sample:1',
        'sampleDelayedEchoWorkflow',
      ),
    );
    const result = await new WorkflowClientService().startWorkflow(input);
    expect(result).toMatchObject({ started: false, reason: 'already_started' });
  });

  it('lets other start errors through', async () => {
    process.env.TEMPORAL_ENABLED = 'true';
    start.mockRejectedValue(new Error('unavailable'));
    await expect(
      new WorkflowClientService().startWorkflow(input),
    ).rejects.toThrow('unavailable');
  });

  it('connects once and reuses the connection', async () => {
    process.env.TEMPORAL_ENABLED = 'true';
    const service = new WorkflowClientService();
    await service.startWorkflow(input);
    await service.startWorkflow({ ...input, workflowId: 'sample:2' });
    expect(connect).toHaveBeenCalledTimes(1);
    await service.onModuleDestroy();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('retries the connection after a failure instead of caching it', async () => {
    process.env.TEMPORAL_ENABLED = 'true';
    connect
      .mockRejectedValueOnce(new Error('refused'))
      .mockResolvedValue({ close });
    const service = new WorkflowClientService();
    await expect(service.startWorkflow(input)).rejects.toThrow('refused');
    await expect(service.startWorkflow(input)).resolves.toMatchObject({
      started: true,
    });
  });

  it('signals with start so an early signal is not lost', async () => {
    process.env.TEMPORAL_ENABLED = 'true';
    await new WorkflowClientService().signalWithStart({
      ...input,
      signal: 'paymentConfirmed',
      signalArgs: [{ ref: 'r1' }],
    });
    expect(signalWithStart).toHaveBeenCalledWith(
      'sampleDelayedEchoWorkflow',
      expect.objectContaining({
        signal: 'paymentConfirmed',
        signalArgs: [{ ref: 'r1' }],
      }),
    );
  });
});
