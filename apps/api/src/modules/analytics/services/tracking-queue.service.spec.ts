import { TrackingQueueService } from './tracking-queue.service';

describe('TrackingQueueService', () => {
  const payload = { type: 'search', query: 'red shoes' };

  it('publishes to the analytics queue and reports the broker confirmation', async () => {
    const rabbitmq = {
      isAvailable: jest.fn().mockReturnValue(true),
      publish: jest.fn().mockResolvedValue(true),
    };

    await expect(
      new TrackingQueueService(rabbitmq as never).enqueue(payload),
    ).resolves.toBe(true);
    expect(rabbitmq.publish).toHaveBeenCalledWith('analytics.event', payload);
  });

  it('says false, without publishing, when the broker is down, so the caller stores the rows itself', async () => {
    const rabbitmq = {
      isAvailable: jest.fn().mockReturnValue(false),
      publish: jest.fn(),
    };

    await expect(
      new TrackingQueueService(rabbitmq as never).enqueue(payload),
    ).resolves.toBe(false);
    expect(rabbitmq.publish).not.toHaveBeenCalled();
  });

  it('says false when the broker refuses the message', async () => {
    const rabbitmq = {
      isAvailable: jest.fn().mockReturnValue(true),
      publish: jest.fn().mockResolvedValue(false),
    };

    await expect(
      new TrackingQueueService(rabbitmq as never).enqueue(payload),
    ).resolves.toBe(false);
  });

  it('says false when there is no broker at all (RabbitMQ not configured)', async () => {
    await expect(new TrackingQueueService().enqueue(payload)).resolves.toBe(
      false,
    );
  });
});
