import type { ShopperActivity } from '../types/shopper-activity.types';
import { ShopperActivityRecorderService } from './shopper-activity-recorder.service';

describe('ShopperActivityRecorderService', () => {
  let publisher: { record: jest.Mock };
  let store: { saveMany: jest.Mock };
  let service: ShopperActivityRecorderService;
  const act = (id: string): ShopperActivity => ({
    id,
    action: 'store_viewed',
    vendorId: 'v1',
  });

  beforeEach(() => {
    publisher = { record: jest.fn().mockResolvedValue(true) };
    store = { saveMany: jest.fn().mockResolvedValue(undefined) };
    service = new ShopperActivityRecorderService(publisher, store as never);
  });

  it('puts an activity on the queue and stores nothing itself when the broker takes it', async () => {
    await service.record(act('a'));

    expect(publisher.record).toHaveBeenCalledWith(act('a'), {
      occurredAt: undefined,
    });
    expect(store.saveMany).not.toHaveBeenCalled();
  });

  it('passes on when it happened', async () => {
    const at = new Date('2026-11-28T10:00:00.000Z');

    await service.record(act('a'), { occurredAt: at });

    expect(publisher.record).toHaveBeenCalledWith(act('a'), { occurredAt: at });
  });

  it('stores the activity directly, at its own time, when the broker cannot take it', async () => {
    publisher.record.mockResolvedValue(false);
    const at = new Date('2026-11-28T10:00:00.000Z');

    await service.record(act('a'), { occurredAt: at });

    expect(store.saveMany).toHaveBeenCalledWith([
      { activity: act('a'), occurredAt: at },
    ]);
  });

  it('stores it as of now when no time was given', async () => {
    publisher.record.mockResolvedValue(false);
    const before = Date.now();

    await service.record(act('a'));

    const [[items]] = store.saveMany.mock.calls as unknown as [
      Array<{ occurredAt: Date }>,
    ][];
    expect(items[0].occurredAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('stores only the ones the broker did not take, in one batch', async () => {
    publisher.record
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);

    await service.recordMany([
      { activity: act('a') },
      { activity: act('b') },
      { activity: act('c') },
    ]);

    expect(store.saveMany).toHaveBeenCalledTimes(1);
    expect(
      store.saveMany.mock.calls[0][0].map((i: any) => i.activity.id),
    ).toEqual(['b', 'c']);
  });

  it('throws when an activity can be neither queued nor stored, so the caller can say so', async () => {
    publisher.record.mockResolvedValue(false);
    store.saveMany.mockRejectedValue(new Error('db down'));

    await expect(service.record(act('a'))).rejects.toThrow('db down');
  });
});
