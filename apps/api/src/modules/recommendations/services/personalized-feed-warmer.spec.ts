import { PersonalizedFeedService } from './personalized-feed.service';
import { PopularProductsService } from './popular-products.service';
import { TransactionRunnerService } from '@api/infrastructure/database/transaction-runner.service';

describe('PersonalizedFeedService feed warming', () => {
  const build = () => {
    const refresh = { registerWarmer: jest.fn() };
    const service = new PersonalizedFeedService(
      {} as never,
      {} as never,
      {} as never,
      new PopularProductsService({} as never),
      undefined,
      refresh as never,
    );
    return { service, refresh };
  };

  const withRole = (role: string | undefined, fn: () => void) => {
    const previous = process.env.PROCESS_ROLE;
    if (role === undefined) delete process.env.PROCESS_ROLE;
    else process.env.PROCESS_ROLE = role;
    try {
      fn();
    } finally {
      if (previous === undefined) delete process.env.PROCESS_ROLE;
      else process.env.PROCESS_ROLE = previous;
    }
  };

  it.each(['worker', 'all', undefined])(
    'registers how to recompute a feed in the %s program, where the refresh runs',
    (role) => {
      const { service, refresh } = build();

      withRole(role, () => service.onModuleInit());

      expect(refresh.registerWarmer).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['api', 'jobs'])(
    'registers nothing in the %s program: the refresh never runs there',
    (role) => {
      const { service, refresh } = build();

      withRole(role, () => service.onModuleInit());

      expect(refresh.registerWarmer).not.toHaveBeenCalled();
    },
  );

  it('recomputes the feed for the shopper it is given, with ids passed through', async () => {
    const { service, refresh } = build();
    const forYou = jest.spyOn(service, 'forYou').mockResolvedValue([] as never);
    withRole('worker', () => service.onModuleInit());
    const warm = refresh.registerWarmer.mock.calls[0][0] as (
      actor: unknown,
    ) => Promise<unknown>;

    await warm({ userId: 'u1', sessionId: 's1', visitorId: null });

    expect(forYou).toHaveBeenCalledWith('u1', 's1', undefined);
  });

  it('works without the refresh service at all (it is optional)', () => {
    const service = new PersonalizedFeedService(
      {} as never,
      {} as never,
      {} as never,
      new PopularProductsService({} as never),
    );

    expect(() =>
      withRole('worker', () => service.onModuleInit()),
    ).not.toThrow();
  });
});
