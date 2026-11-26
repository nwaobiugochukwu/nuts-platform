import { WorkflowStartConsumer } from './workflow-start.consumer';

describe('WorkflowStartConsumer', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  function build(enabled: boolean) {
    let handler: (message: unknown) => Promise<void> = () => Promise.resolve();
    const rabbit = {
      consume: jest.fn((_queue: string, fn: typeof handler) => {
        handler = fn;
        return Promise.resolve();
      }),
    };
    const temporal = {
      enabled,
      startWorkflow: jest
        .fn()
        .mockResolvedValue({ started: true, workflowId: 'w' }),
    };
    const consumer = new WorkflowStartConsumer(
      rabbit as never,
      temporal as never,
    );
    return { consumer, rabbit, temporal, run: (m: unknown) => handler(m) };
  }

  it('consumes the workflows queue and starts what it is told to', async () => {
    delete process.env.PROCESS_ROLE;
    const { consumer, rabbit, temporal, run } = build(true);
    await consumer.onModuleInit();
    expect(rabbit.consume).toHaveBeenCalledWith(
      'q.nuts.workflows',
      expect.any(Function),
    );
    const message = {
      workflowType: 'T',
      workflowId: 'order-payment:1',
      taskQueue: 'nuts-payments',
      args: [1],
    };
    await run(message);
    expect(temporal.startWorkflow).toHaveBeenCalledWith(message);
  });

  it('ignores malformed messages', async () => {
    delete process.env.PROCESS_ROLE;
    const { consumer, temporal, run } = build(true);
    await consumer.onModuleInit();
    await run({ workflowType: 'T' });
    expect(temporal.startWorkflow).not.toHaveBeenCalled();
  });

  it('does not consume when Temporal is disabled or the role has no consumers', async () => {
    delete process.env.PROCESS_ROLE;
    const disabled = build(false);
    await disabled.consumer.onModuleInit();
    expect(disabled.rabbit.consume).not.toHaveBeenCalled();

    process.env.PROCESS_ROLE = 'api';
    const api = build(true);
    await api.consumer.onModuleInit();
    expect(api.rabbit.consume).not.toHaveBeenCalled();
  });
});
