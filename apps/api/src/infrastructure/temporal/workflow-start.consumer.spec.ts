import { RABBITMQ_QUEUES } from '../rabbitmq/rabbitmq.constants';
import { fakeRabbit, withRole } from '../rabbitmq/consumer-harness-spec';
import { WorkflowStartConsumer } from './workflow-start.consumer';

describe('WorkflowStartConsumer', () => {
  let harness: ReturnType<typeof fakeRabbit>;
  let temporal: { enabled: boolean; startWorkflow: jest.Mock };
  let consumer: WorkflowStartConsumer;
  const request = {
    workflowType: 'orderPayment',
    workflowId: 'order-payment:o1',
    taskQueue: 'nuts',
  };

  beforeEach(() => {
    harness = fakeRabbit();
    temporal = {
      enabled: true,
      startWorkflow: jest.fn().mockResolvedValue({ started: true }),
    };
    consumer = new WorkflowStartConsumer(harness.rabbit, temporal as never);
    jest
      .spyOn((consumer as any).logger, 'warn')
      .mockImplementation(() => undefined);
    jest
      .spyOn((consumer as any).logger, 'debug')
      .mockImplementation(() => undefined);
  });

  async function handle(payload: unknown) {
    await consumer.onModuleInit();
    return harness.handlerFor(RABBITMQ_QUEUES.WORKFLOWS)(payload);
  }

  it('starts the requested workflow', async () => {
    await handle(request);

    expect(temporal.startWorkflow).toHaveBeenCalledWith(request);
  });

  it('does not consume while Temporal is disabled', async () => {
    temporal.enabled = false;

    await consumer.onModuleInit();

    expect(harness.consume).not.toHaveBeenCalled();
  });

  it('does not consume in the api program', async () => {
    await withRole('api', () => consumer.onModuleInit());

    expect(harness.consume).not.toHaveBeenCalled();
  });

  it.each([
    ['no payload', undefined],
    ['no workflow type', { workflowId: 'w', taskQueue: 'q' }],
    ['no workflow id', { workflowType: 't', taskQueue: 'q' }],
    ['no task queue', { workflowType: 't', workflowId: 'w' }],
  ])(
    'skips a malformed request (%s) without failing it',
    async (_label, payload) => {
      await expect(handle(payload)).resolves.toBeUndefined();
      expect(temporal.startWorkflow).not.toHaveBeenCalled();
    },
  );

  it('treats an already-started workflow as a harmless duplicate', async () => {
    temporal.startWorkflow.mockResolvedValue({
      started: false,
      reason: 'already_started',
    });

    await expect(handle(request)).resolves.toBeUndefined();
  });

  it('lets a Temporal failure fail the message so it is retried', async () => {
    temporal.startWorkflow.mockRejectedValue(new Error('temporal unreachable'));

    await expect(handle(request)).rejects.toThrow('temporal unreachable');
  });
});
