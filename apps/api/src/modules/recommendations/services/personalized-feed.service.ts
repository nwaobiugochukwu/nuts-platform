/** "For you", recently viewed, claimed history and followed-store feeds. */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { roleCan } from '@api/config/process-role.config';
import { RecommendationRefreshService } from '@api/modules/analytics/services/recommendation-refresh.service';
import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { TransactionRunnerService } from '@api/infrastructure/database/transaction-runner.service';
import { ProductCatalogService } from '@api/modules/products/services/product-catalog.service';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import { PopularProductsService } from './popular-products.service';
import {
  PURCHASE_STATUSES,
  RECOMMENDATION_LIMIT,
  PERSONALIZED_RECOMMENDATION_POOL_LIMIT,
  HISTORY_DAYS,
  EXPOSURE_SUPPRESSION_DAYS,
  AVAILABLE_PRODUCT,
  EXPLORATION_SLOTS,
  addWeight,
  applyDismissalPenalty,
  searchTokens,
  scoreAndDiversify,
  explainRecommendation,
} from '../utils/recommendation.util';

/** Event type stored when a shopper dismisses a recommendation. */
export const NOT_INTERESTED_EVENT = 'NOT_INTERESTED';

@Injectable()
export class PersonalizedFeedService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionRunnerService,
    private readonly products: ProductCatalogService,
    private readonly popular: PopularProductsService,
    @Optional() private readonly cacheService?: CacheService,
    @Optional() private readonly refresh?: RecommendationRefreshService,
  ) {}

  /**
   * In the worker, after a shopper's burst of clicks has been stored and their cached feed
   * cleared, recompute it here so the shopper's next read is a cache hit instead of a
   * multi-second recompute on the request.
   */
  onModuleInit(): void {
    if (!roleCan('consumers')) return;
    this.refresh?.registerWarmer((actor) =>
      this.forYou(
        actor.userId ?? undefined,
        actor.sessionId ?? undefined,
        actor.visitorId ?? undefined,
      ),
    );
  }

  async forYou(userId?: string, sessionId?: string, visitorId?: string) {
    const actorKey = userId ?? visitorId ?? sessionId ?? 'anonymous';
    const fetcher = async () => {
      const historyStart = new Date(
        Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000,
      );
      const guestHistoryIds = [
        ...new Set(
          [visitorId, sessionId].filter((id): id is string => Boolean(id)),
        ),
      ];
      const recentHistoryWhere: Prisma.RecentProductViewWhereInput = userId
        ? {
            OR: [
              { userId },
              ...(guestHistoryIds.length
                ? [{ visitorId: { in: guestHistoryIds } }]
                : []),
            ],
          }
        : {
            visitorId: { in: guestHistoryIds },
            lastViewedAt: { gte: historyStart },
          };
      const activityActor = userId
        ? {
            OR: [
              { userId },
              ...(sessionId ? [{ userId: null, sessionId }] : []),
            ],
          }
        : { userId: null, sessionId: sessionId ?? '__no_session__' };
      const [
        views,
        durableViews,
        purchases,
        wishlist,
        cartItems,
        searches,
        clicks,
        recentImpressions,
        follows,
        categoryViews,
        vendorClicks,
        dismissals,
      ] = await Promise.all([
        this.prisma.productView.findMany({
          where: { ...activityActor, createdAt: { gte: historyStart } },
          orderBy: { createdAt: 'desc' },
          take: 60,
          select: { productId: true, createdAt: true },
        }),
        this.prisma.recentProductView.findMany({
          where: recentHistoryWhere,
          orderBy: { lastViewedAt: 'desc' },
          take: 60,
          select: { productId: true, lastViewedAt: true },
        }),
        userId
          ? this.prisma.orderItem.findMany({
              where: {
                order: {
                  userId,
                  status: { in: PURCHASE_STATUSES },
                  createdAt: { gte: historyStart },
                },
              },
              orderBy: { createdAt: 'desc' },
              take: 50,
              select: { productId: true, quantity: true },
            })
          : Promise.resolve([]),
        userId
          ? this.prisma.wishlistItem.findMany({
              where: { userId, createdAt: { gte: historyStart } },
              orderBy: { createdAt: 'desc' },
              take: 40,
              select: { productId: true },
            })
          : Promise.resolve([]),
        userId
          ? this.prisma.cartItem.findMany({
              where: { cart: { userId, checkedOut: false } },
              orderBy: { updatedAt: 'desc' },
              take: 40,
              select: { productId: true, quantity: true },
            })
          : Promise.resolve([]),
        this.prisma.searchQuery.findMany({
          where: userId
            ? {
                OR: [
                  { userId },
                  ...(sessionId ? [{ userId: null, sessionId }] : []),
                ],
                createdAt: { gte: historyStart },
              }
            : {
                userId: null,
                sessionId: sessionId ?? '__no_session__',
                createdAt: { gte: historyStart },
              },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { query: true },
        }),
        this.prisma.recommendationEvent.findMany({
          where: {
            ...activityActor,
            eventType: 'CLICK',
            productId: { not: null },
            createdAt: { gte: historyStart },
          },
          orderBy: { createdAt: 'desc' },
          take: 40,
          select: { productId: true, createdAt: true },
        }),
        this.prisma.recommendationEvent.findMany({
          where: {
            ...activityActor,
            eventType: 'IMPRESSION',
            surface: 'HOME_FOR_YOU',
            productId: { not: null },
            createdAt: {
              gte: new Date(
                Date.now() - EXPOSURE_SUPPRESSION_DAYS * 24 * 60 * 60 * 1000,
              ),
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 500,
          select: { productId: true },
        }),
        userId
          ? this.prisma.vendorFollow.findMany({
              where: { userId, vendor: { isActive: true, isApproved: true } },
              orderBy: { createdAt: 'desc' },
              take: 200,
              select: { vendorId: true },
            })
          : Promise.resolve([]),
        this.prisma.recommendationEvent.findMany({
          where: {
            ...activityActor,
            eventType: 'CATEGORY_VIEW',
            categoryId: { not: null },
            createdAt: { gte: historyStart },
          },
          orderBy: { createdAt: 'desc' },
          take: 60,
          select: { categoryId: true, createdAt: true },
        }),
        this.prisma.recommendationEvent.findMany({
          where: {
            ...activityActor,
            eventType: 'CLICK',
            productId: null,
            vendorId: { not: null },
            createdAt: { gte: historyStart },
          },
          orderBy: { createdAt: 'desc' },
          take: 40,
          select: { vendorId: true, createdAt: true },
        }),
        // "Not interested" never expires: a dismissed product stays hidden.
        this.prisma.recommendationEvent.findMany({
          where: {
            ...activityActor,
            eventType: NOT_INTERESTED_EVENT,
            productId: { not: null },
          },
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: { productId: true },
        }),
      ]);
      const dismissedIds = new Set(
        dismissals.flatMap(({ productId }) => (productId ? [productId] : [])),
      );

      // The durable recent-view record is written before the analytics buffer is
      // flushed. Merge it with legacy ProductView rows so fresh browsing affects
      // recommendations immediately, without counting the same product twice.
      const viewActivityByProduct = new Map<string, Date>();
      for (const view of views) {
        const existing = viewActivityByProduct.get(view.productId);
        if (!existing || view.createdAt > existing) {
          viewActivityByProduct.set(view.productId, view.createdAt);
        }
      }
      for (const view of durableViews) {
        const existing = viewActivityByProduct.get(view.productId);
        if (!existing || view.lastViewedAt > existing) {
          viewActivityByProduct.set(view.productId, view.lastViewedAt);
        }
      }
      const recentViewSignals = [...viewActivityByProduct.entries()]
        .sort((a, b) => b[1].getTime() - a[1].getTime())
        .slice(0, 60)
        .map(([productId, createdAt]) => ({ productId, createdAt }));

      const seedWeights = new Map<string, number>();
      for (const purchase of purchases) {
        addWeight(
          seedWeights,
          purchase.productId,
          9 + Math.min(3, Math.log2(Math.max(1, purchase.quantity))),
        );
      }
      for (const item of cartItems) {
        addWeight(
          seedWeights,
          item.productId,
          7 + Math.min(2, item.quantity / 3),
        );
      }
      for (const item of wishlist) addWeight(seedWeights, item.productId, 6);
      for (const [index, click] of clicks.entries()) {
        if (!click.productId) continue;
        const ageDays = Math.max(
          0,
          (Date.now() - click.createdAt.getTime()) / (24 * 60 * 60 * 1000),
        );
        addWeight(
          seedWeights,
          click.productId,
          Math.max(1, 4 * Math.exp(-ageDays / 35)) * Math.pow(0.97, index),
        );
      }
      for (const [index, view] of recentViewSignals.entries()) {
        const ageDays = Math.max(
          0,
          (Date.now() - view.createdAt.getTime()) / (24 * 60 * 60 * 1000),
        );
        addWeight(
          seedWeights,
          view.productId,
          Math.max(0.25, 2.5 * Math.exp(-ageDays / 45)) * Math.pow(0.98, index),
        );
      }

      const seedIds = [...seedWeights.keys()];
      const viewedSeedIds = new Set(seedIds);
      const recentImpressionIds = new Set(
        recentImpressions.flatMap(({ productId }) =>
          productId ? [productId] : [],
        ),
      );
      const suppressedIds = [
        ...new Set([...seedIds, ...recentImpressionIds, ...dismissedIds]),
      ];
      const searchWeights = searchTokens(searches.map(({ query }) => query));
      if (
        seedIds.length === 0 &&
        searchWeights.size === 0 &&
        follows.length === 0 &&
        categoryViews.length === 0 &&
        vendorClicks.length === 0
      ) {
        return this.popular.discover();
      }

      const seedProducts = seedIds.length
        ? await this.prisma.product.findMany({
            where: { id: { in: seedIds } },
            select: { id: true, categoryId: true, vendorId: true },
          })
        : [];
      const categoryWeights = new Map<string, number>();
      const vendorWeights = new Map<string, number>();
      for (const product of seedProducts) {
        const weight = seedWeights.get(product.id) ?? 0;
        addWeight(categoryWeights, product.categoryId, weight);
        addWeight(vendorWeights, product.vendorId, weight);
      }
      for (const [index, event] of categoryViews.entries()) {
        if (!event.categoryId) continue;
        const ageDays = Math.max(
          0,
          (Date.now() - event.createdAt.getTime()) / (24 * 60 * 60 * 1000),
        );
        addWeight(
          categoryWeights,
          event.categoryId,
          Math.max(1, 4 * Math.exp(-ageDays / 45)) * Math.pow(0.96, index),
        );
      }
      if (dismissedIds.size > 0) {
        const dismissedProducts = await this.prisma.product.findMany({
          where: { id: { in: [...dismissedIds] } },
          select: { categoryId: true },
        });
        applyDismissalPenalty(
          categoryWeights,
          dismissedProducts.map(({ categoryId }) => categoryId),
        );
      }
      for (const follow of follows)
        addWeight(vendorWeights, follow.vendorId, 3.5);
      for (const [index, event] of vendorClicks.entries()) {
        if (!event.vendorId) continue;
        const ageDays = Math.max(
          0,
          (Date.now() - event.createdAt.getTime()) / (24 * 60 * 60 * 1000),
        );
        addWeight(
          vendorWeights,
          event.vendorId,
          Math.max(1, 4 * Math.exp(-ageDays / 35)) * Math.pow(0.97, index),
        );
      }

      const purchasedSeedIds = [
        ...new Set(purchases.map(({ productId }) => productId)),
      ];
      const coPurchases = purchasedSeedIds.length
        ? await this.prisma.orderItem.groupBy({
            by: ['productId'],
            where: {
              productId: { notIn: suppressedIds },
              order: {
                status: { in: PURCHASE_STATUSES },
                orderItems: { some: { productId: { in: purchasedSeedIds } } },
              },
              product: {
                isActive: true,
                isDeleted: false,
                category: { is: { isActive: true } },
                vendor: { isActive: true, isApproved: true },
                ...AVAILABLE_PRODUCT,
              },
            },
            _sum: { quantity: true },
            _count: { _all: true },
            orderBy: { _sum: { quantity: 'desc' } },
            take: 100,
          })
        : [];
      const coPurchaseScores = new Map(
        coPurchases.map((item) => [
          item.productId,
          Math.log1p(item._sum.quantity ?? 0) * 4 +
            Math.log1p(item._count._all) * 3,
        ]),
      );

      const interestConditions: Prisma.ProductWhereInput[] = [];
      if (categoryWeights.size > 0) {
        interestConditions.push({
          categoryId: { in: [...categoryWeights.keys()] },
        });
      }
      if (vendorWeights.size > 0) {
        interestConditions.push({
          vendorId: { in: [...vendorWeights.keys()] },
        });
      }
      if (searchWeights.size > 0) {
        interestConditions.push(
          ...[...searchWeights.keys()].map((token) => ({
            OR: [
              { name: { contains: token, mode: 'insensitive' as const } },
              {
                description: { contains: token, mode: 'insensitive' as const },
              },
              {
                category: {
                  is: {
                    name: { contains: token, mode: 'insensitive' as const },
                  },
                },
              },
            ],
          })),
        );
      }

      const contentCandidates = interestConditions.length
        ? await this.prisma.product.findMany({
            where: {
              id: { notIn: suppressedIds },
              isActive: true,
              isDeleted: false,
              category: { is: { isActive: true } },
              vendor: { isActive: true, isApproved: true },
              ...AVAILABLE_PRODUCT,
              AND: [{ OR: interestConditions }],
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 100,
            select: {
              id: true,
              name: true,
              description: true,
              categoryId: true,
              vendorId: true,
              createdAt: true,
              category: { select: { name: true } },
            },
          })
        : [];

      const candidateIds = [
        ...new Set([
          ...coPurchases.map(({ productId }) => productId),
          ...contentCandidates.map(({ id }) => id),
        ]),
      ].slice(0, 160);
      const candidates = candidateIds.length
        ? await this.prisma.product.findMany({
            where: {
              id: { in: candidateIds, notIn: suppressedIds },
              isActive: true,
              isDeleted: false,
              category: { is: { isActive: true } },
              vendor: { isActive: true, isApproved: true },
              ...AVAILABLE_PRODUCT,
            },
            select: {
              id: true,
              name: true,
              description: true,
              categoryId: true,
              vendorId: true,
              createdAt: true,
              category: { select: { name: true } },
            },
          })
        : [];

      const recommendationCandidateById = new Map(
        candidates.map((candidate) => [candidate.id, candidate]),
      );
      // Prefer products the shopper has not recently seen, but do not let
      // impression suppression empty the whole shelf in a small catalog.
      if (
        interestConditions.length > 0 &&
        recommendationCandidateById.size <
          PERSONALIZED_RECOMMENDATION_POOL_LIMIT
      ) {
        const repeatableCandidates = await this.prisma.product.findMany({
          where: {
            id: { notIn: seedIds },
            isActive: true,
            isDeleted: false,
            category: { is: { isActive: true } },
            vendor: { isActive: true, isApproved: true },
            ...AVAILABLE_PRODUCT,
            AND: [{ OR: interestConditions }],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 100,
          select: {
            id: true,
            name: true,
            description: true,
            categoryId: true,
            vendorId: true,
            createdAt: true,
            category: { select: { name: true } },
          },
        });
        for (const candidate of repeatableCandidates) {
          recommendationCandidateById.set(candidate.id, candidate);
        }
      }
      const recommendationCandidates = [
        ...recommendationCandidateById.values(),
      ];

      const freshRecommendationIds = scoreAndDiversify(
        recommendationCandidates,
        new Set([...viewedSeedIds, ...recentImpressionIds, ...dismissedIds]),
        categoryWeights,
        vendorWeights,
        searchWeights,
        coPurchaseScores,
        PERSONALIZED_RECOMMENDATION_POOL_LIMIT,
        new Set(),
        EXPLORATION_SLOTS,
      );
      const fallbackRecommendationIds =
        freshRecommendationIds.length < PERSONALIZED_RECOMMENDATION_POOL_LIMIT
          ? scoreAndDiversify(
              recommendationCandidates,
              new Set([
                ...viewedSeedIds,
                ...freshRecommendationIds,
                ...dismissedIds,
              ]),
              categoryWeights,
              vendorWeights,
              searchWeights,
              coPurchaseScores,
              PERSONALIZED_RECOMMENDATION_POOL_LIMIT -
                freshRecommendationIds.length,
              recentImpressionIds,
            )
          : [];
      const recommendedIds = [
        ...freshRecommendationIds,
        ...fallbackRecommendationIds,
      ];
      // Keep the shelf grounded in the shopper's signals. Previously exposed
      // related products may reappear with a score penalty when the catalog is
      // too small to supply a full unseen pool.
      const cards = await this.products.findPublicCardsByIds(
        recommendedIds,
        true,
      );
      const candidateById = new Map(
        recommendationCandidates.map((candidate) => [candidate.id, candidate]),
      );
      const followedVendorIds = new Set(
        follows.map(({ vendorId }) => vendorId),
      );
      const personalized = cards.map((card) => {
        const candidate = candidateById.get(card.id);
        return candidate
          ? {
              ...card,
              recommendationReason: explainRecommendation(
                candidate,
                coPurchaseScores,
                followedVendorIds,
                categoryWeights,
                vendorWeights,
                searchWeights,
              ),
            }
          : card;
      });

      // Interest matching can be narrow (small catalog, niche taste). Keep the
      // shelf full by topping up with popular products the shopper has not
      // already viewed; personalised picks always stay first.
      if (personalized.length >= RECOMMENDATION_LIMIT) return personalized;
      const taken = new Set([
        ...personalized.map(({ id }) => id),
        ...viewedSeedIds,
        ...dismissedIds,
      ]);
      const popular = await this.popular.discoverPool();
      const filled = [
        ...personalized,
        ...popular
          .filter((card) => !taken.has(card.id))
          .slice(0, RECOMMENDATION_LIMIT - personalized.length),
      ];

      // Last resort for small catalogues / heavy browsers: a shopper who has
      // already viewed most products must still get a shelf. Unseen items
      // always rank first; re-showing a viewed product beats an empty row.
      if (filled.length < RECOMMENDATION_LIMIT) {
        const used = new Set([
          ...filled.map((card) => card.id),
          ...dismissedIds,
        ]);
        filled.push(
          ...popular
            .filter((card) => !used.has(card.id))
            .slice(0, RECOMMENDATION_LIMIT - filled.length),
        );
      }
      return filled;
    };

    return this.cacheService
      ? this.cacheService.wrap(
          `recommendations:for-you:${actorKey}`,
          90,
          fetcher,
        )
      : fetcher();
  }

  /**
   * Records "Not interested" for a product so it stops appearing on the
   * personalised shelf. Safe to repeat. The cached shelf is dropped so the
   * next read reflects it immediately.
   */
  async dismissProduct(input: {
    productId: string;
    userId?: string;
    sessionId?: string;
    visitorId?: string;
  }): Promise<{ dismissed: true }> {
    const { productId, userId, sessionId, visitorId } = input;
    if (!userId && !sessionId && !visitorId) {
      throw new BadRequestException('A session or sign-in is required.');
    }
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, vendorId: true, categoryId: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    const actor = userId
      ? { userId }
      : { userId: null, sessionId: sessionId ?? visitorId ?? null };
    const already = await this.prisma.recommendationEvent.findFirst({
      where: {
        ...actor,
        eventType: NOT_INTERESTED_EVENT,
        productId,
      },
      select: { id: true },
    });
    if (!already) {
      await this.prisma.recommendationEvent.create({
        data: {
          eventType: NOT_INTERESTED_EVENT,
          surface: 'HOME_FOR_YOU',
          productId,
          vendorId: product.vendorId,
          categoryId: product.categoryId,
          userId: userId ?? null,
          sessionId: sessionId ?? visitorId ?? null,
        },
      });
    }
    await this.cacheService?.invalidateRecommendations(
      userId,
      sessionId,
      visitorId,
    );
    return { dismissed: true };
  }

  async recentlyViewed(
    userId?: string,
    sessionId?: string,
    visitorId?: string,
  ) {
    if (!userId && !sessionId && !visitorId) return [];
    const historyStart = new Date(
      Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000,
    );
    const guestHistoryIds = [
      ...new Set(
        [visitorId, sessionId].filter((id): id is string => Boolean(id)),
      ),
    ];
    const historyScope: Prisma.RecentProductViewWhereInput = userId
      ? {
          OR: [
            { userId },
            ...(guestHistoryIds.length
              ? [{ visitorId: { in: guestHistoryIds } }]
              : []),
          ],
        }
      : {
          visitorId: { in: guestHistoryIds },
          lastViewedAt: { gte: historyStart },
        };
    const legacyActor = userId
      ? {
          OR: [{ userId }, ...(sessionId ? [{ userId: null, sessionId }] : [])],
        }
      : { userId: null, sessionId };
    const [history, legacyViews] = await Promise.all([
      this.prisma.recentProductView.findMany({
        where: historyScope,
        orderBy: { lastViewedAt: 'desc' },
        take: 100,
        select: { productId: true, lastViewedAt: true },
      }),
      sessionId || userId
        ? this.prisma.productView.findMany({
            where: { ...legacyActor, createdAt: { gte: historyStart } },
            orderBy: { createdAt: 'desc' },
            take: 100,
            select: { productId: true, createdAt: true },
          })
        : Promise.resolve([]),
    ]);
    const latestByProduct = new Map<string, Date>();
    for (const view of [
      ...history,
      ...legacyViews.map(({ productId, createdAt }) => ({
        productId,
        lastViewedAt: createdAt,
      })),
    ]) {
      const existing = latestByProduct.get(view.productId);
      if (!existing || view.lastViewedAt > existing)
        latestByProduct.set(view.productId, view.lastViewedAt);
    }
    const uniqueIds = [...latestByProduct.entries()]
      .sort((a, b) => b[1].getTime() - a[1].getTime())
      .slice(0, 12)
      .map(([productId]) => productId);
    return this.products.findPublicCardsByIds(uniqueIds, true);
  }

  async claimRecentlyViewed(userId: string, visitorId: string) {
    const result = await this.transactions.run(
      async ({ tx }) => {
        const visitorViews = await tx.recentProductView.findMany({
          where: { visitorId },
          orderBy: { lastViewedAt: 'desc' },
          take: 100,
          select: { productId: true, lastViewedAt: true },
        });
        if (!visitorViews.length) return { claimed: 0 };

        const existingViews = await tx.recentProductView.findMany({
          where: {
            userId,
            productId: { in: visitorViews.map(({ productId }) => productId) },
          },
          select: { productId: true, lastViewedAt: true },
        });
        const existingByProduct = new Map(
          existingViews.map((view) => [view.productId, view.lastViewedAt]),
        );
        const toCreate = visitorViews
          .filter((view) => !existingByProduct.has(view.productId))
          .map((view) => ({
            userId,
            productId: view.productId,
            lastViewedAt: view.lastViewedAt,
          }));
        if (toCreate.length) {
          await tx.recentProductView.createMany({
            data: toCreate,
            skipDuplicates: true,
          });
        }

        const toAdvance = visitorViews.filter((view) => {
          const existing = existingByProduct.get(view.productId);
          return existing && view.lastViewedAt > existing;
        });
        for (const view of toAdvance) {
          await tx.recentProductView.updateMany({
            where: {
              userId,
              productId: view.productId,
              lastViewedAt: { lt: view.lastViewedAt },
            },
            data: { lastViewedAt: view.lastViewedAt },
          });
        }

        // Keep visitor rows through the guest-history retention window so a
        // delayed auth hydration or another tab can still claim them safely.
        // Report only rows that actually changed, so re-running this (it is
        // idempotent) is correctly seen as "nothing new".
        return { claimed: toCreate.length + toAdvance.length };
      },
      { name: 'feed.claim-recently-viewed' },
    );

    if (result.claimed > 0) {
      // History just changed under this user: drop shelves cached for either
      // identity so the next read reflects the merged history.
      await this.cacheService?.invalidateRecommendations(userId, visitorId);
    }
    return result;
  }

  async following(userId: string) {
    const followed = await this.prisma.vendorFollow.findMany({
      where: { userId, vendor: { isActive: true, isApproved: true } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { vendorId: true },
    });
    const vendorIds = followed.map(({ vendorId }) => vendorId);
    if (!vendorIds.length) return [];

    // A follow feed must be stable: newest products first, never hidden because
    // the shopper already saw them. Each store contributes its newest few so a
    // prolific store cannot crowd out the others.
    const PER_STORE_FETCH = 4;
    const PER_STORE_SHOWN = 3;
    const FEED_SIZE = 24;
    const findStoreProducts = (vendorId: string) =>
      this.prisma.product.findMany({
        where: {
          vendorId,
          isActive: true,
          isDeleted: false,
          category: { is: { isActive: true } },
          ...AVAILABLE_PRODUCT,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: PER_STORE_FETCH,
        select: { id: true, vendorId: true, createdAt: true },
      });
    const pool: Array<{ id: string; vendorId: string; createdAt: Date }> = [];
    for (let offset = 0; offset < vendorIds.length; offset += 10) {
      const batch = await Promise.all(
        vendorIds.slice(offset, offset + 10).map(findStoreProducts),
      );
      pool.push(...batch.flat());
    }
    pool.sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() ||
        b.id.localeCompare(a.id),
    );
    const shownPerStore = new Map<string, number>();
    const selectedIds: string[] = [];
    for (const product of pool) {
      const shown = shownPerStore.get(product.vendorId) ?? 0;
      if (shown >= PER_STORE_SHOWN) continue;
      shownPerStore.set(product.vendorId, shown + 1);
      selectedIds.push(product.id);
      if (selectedIds.length >= FEED_SIZE) break;
    }
    const cards = await this.products.findPublicCardsByIds(selectedIds, true);
    // findPublicCardsByIds does not guarantee input order; keep newest-first.
    const byId = new Map(cards.map((card) => [card.id, card]));
    return selectedIds.flatMap((id) => {
      const card = byId.get(id);
      return card ? [card] : [];
    });
  }
}
