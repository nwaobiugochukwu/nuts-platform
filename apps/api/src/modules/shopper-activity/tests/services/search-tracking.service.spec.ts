import { SearchTrackingService } from '../../services/search-tracking.service';

describe('SearchTrackingService', () => {
  let recorder: { record: jest.Mock };
  let service: SearchTrackingService;

  beforeEach(() => {
    recorder = { record: jest.fn().mockResolvedValue(undefined) };
    service = new SearchTrackingService(recorder as never);
  });

  it('records the search as a searched activity under an id of its own, with who searched', async () => {
    await service.trackSearch('red shoes', 3, 'u1', 's1', 'v1');

    expect(recorder.record).toHaveBeenCalledWith({
      action: 'searched',
      id: expect.any(String),
      query: 'red shoes',
      resultsCount: 3,
      userId: 'u1',
      sessionId: 's1',
      visitorId: 'v1',
    });
  });

  it('records a guest with no user', async () => {
    await service.trackSearch('x', 0, undefined, 's1', 'v1');

    expect(recorder.record.mock.calls[0][0]).toMatchObject({
      userId: null,
      sessionId: 's1',
      visitorId: 'v1',
    });
  });

  it('gives every search its own id, so two identical searches are two searches', async () => {
    await service.trackSearch('x', 1);
    await service.trackSearch('x', 1);

    expect(recorder.record.mock.calls[0][0].id).not.toBe(
      recorder.record.mock.calls[1][0].id,
    );
  });

  it('lets a failure to record through, for the caller to decide what that means', async () => {
    recorder.record.mockRejectedValue(new Error('db down'));

    await expect(service.trackSearch('x', 1)).rejects.toThrow('db down');
  });
});
