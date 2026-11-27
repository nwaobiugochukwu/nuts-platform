import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';

import { CacheService } from '@api/infrastructure/cache/cache.service';
import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { TransactionRunnerService } from '@api/infrastructure/database/transaction-runner.service';
import { DomainEvents } from '@api/infrastructure/messaging/events/domain-events.constants';
import {
  PRODUCT_REVIEWS_CACHE_PREFIX,
  productReviewsCacheKeys,
} from '../constants/review-cache.constants';
import {
  getErrorCode,
  getErrorMessage,
} from '@api/common/utils/error-details.util';
import {
  CreateReviewDto,
  ProductReviewsResponseDto,
  ReviewResponseDto,
} from '../dto/create-review.dto';

// Prevent a single product from returning an unbounded response.
const MAX_REVIEWS_PER_PRODUCT = 100;

const REVIEW_USER_SELECT = {
  select: {
    firstName: true,
    lastName: true,
  },
} as const;

type ReviewWithUser = Prisma.ReviewGetPayload<{
  include: {
    user: typeof REVIEW_USER_SELECT;
  };
}>;

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly transactions: TransactionRunnerService,
  ) {}

  async create(
    userId: string,
    dto: CreateReviewDto,
  ): Promise<ReviewResponseDto> {
    /*
     * We don't need to load the order or order items.
     *
     * EXISTS semantics are enough:
     * "Does at least one delivered order belonging to this user
     * contain this product?"
     *
     * Prisma translates this relation filter into an efficient
     * relational existence query.
     */
    const purchase = await this.prisma.order.findFirst({
      where: {
        userId,
        status: OrderStatus.DELIVERED,
        orderItems: {
          some: {
            productId: dto.productId,
          },
        },
      },
      select: {
        id: true,
      },
    });

    if (!purchase) {
      throw new BadRequestException(
        'You can only review products you have purchased and received.',
      );
    }

    let review: ReviewWithUser;

    try {
      /*
       * Do not perform a "does review already exist?" query before create.
       *
       * That creates a race:
       *
       * Request A -> doesn't exist
       * Request B -> doesn't exist
       * Request A -> creates
       * Request B -> creates
       *
       * The database UNIQUE(userId, productId) constraint is the
       * authoritative concurrency guard.
       */
      review = await this.transactions.run(
        async (ctx) => {
          const created = await ctx.tx.review.create({
            data: {
              rating: dto.rating,
              comment: dto.comment,
              userId,
              productId: dto.productId,
            },
            include: {
              user: REVIEW_USER_SELECT,
            },
          });
          // The rating summary on the product is refreshed by a consumer of this event; it
          // exists if and only if the review does.
          await ctx.publish({
            type: DomainEvents.REVIEW_CREATED,
            aggregate: { type: 'review', id: created.id },
            actor: { type: 'user', id: userId },
            payload: {
              reviewId: created.id,
              productId: dto.productId,
              userId,
              rating: created.rating,
            },
          });
          return created;
        },
        { name: 'review.create', preset: 'short' },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('You have already reviewed this product');
      }

      throw error;
    }

    // Only invalidate after the DB write succeeds.
    await this.invalidateProductReviewsCache(dto.productId);

    return this.toResponseDto(review);
  }

  async findByProduct(productId: string): Promise<ProductReviewsResponseDto> {
    const cacheKey = `${PRODUCT_REVIEWS_CACHE_PREFIX}${productId}:v2`;

    return this.cacheService.wrap(cacheKey, 300, async () => {
      try {
        const reviews = await this.prisma.review.findMany({
          where: {
            productId,
            isActive: true,
          },
          select: {
            id: true,
            rating: true,
            comment: true,
            productId: true,
            userId: true,
            createdAt: true,
            updatedAt: true,
            isActive: true,
            user: REVIEW_USER_SELECT,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: MAX_REVIEWS_PER_PRODUCT,
        });

        const items = reviews.map((review) => this.toResponseDto(review));

        // The summary is stored on the product and kept current by review events, so it counts
        // every review, not just the page returned here, and costs one row read.
        const summary = await this.prisma.product.findUnique({
          where: { id: productId },
          select: {
            ratingCount: true,
            ratingAverage: true,
            ratingBreakdown: true,
          },
        });

        const emptyBreakdown: Record<number, number> = {
          1: 0,
          2: 0,
          3: 0,
          4: 0,
          5: 0,
        };

        return {
          data: items,
          meta: {
            total: summary?.ratingCount ?? items.length,
            averageRating: summary?.ratingAverage ?? 0,
            ratingBreakdown:
              (summary?.ratingBreakdown as Record<number, number> | null) ??
              emptyBreakdown,
          },
        };
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        if (
          getErrorCode(error) === 'P2021' ||
          (errorMessage.includes('reviews') &&
            errorMessage.includes('does not exist'))
        ) {
          this.logger.warn(
            `Table public.reviews does not exist yet. Returning empty reviews for product ${productId}.`,
          );
          return {
            data: [],
            meta: {
              total: 0,
              averageRating: 0,
              ratingBreakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
            },
          };
        }
        throw error;
      }
    });
  }

  async remove(userId: string, reviewId: string): Promise<void> {
    /*
     * Fetch only what is needed for authorization and cache invalidation.
     */
    const review = await this.prisma.review.findUnique({
      where: {
        id: reviewId,
      },
      select: {
        userId: true,
        productId: true,
        isActive: true,
      },
    });

    if (!review) {
      throw new NotFoundException('Review not found');
    }

    if (review.userId !== userId) {
      // 403 matches the controller's documented API behaviour.
      throw new ForbiddenException('You can only delete your own reviews');
    }

    if (!review.isActive) {
      // DELETE is idempotent from the client's perspective.
      return;
    }

    /*
     * Soft delete instead of physically deleting.
     *
     * This preserves the historical record while keeping the review
     * invisible to customers.
     */
    await this.transactions.run(
      async (ctx) => {
        await ctx.tx.review.update({
          where: {
            id: reviewId,
          },
          data: {
            isActive: false,
          },
        });
        await ctx.publish({
          type: DomainEvents.REVIEW_DELETED,
          aggregate: { type: 'review', id: reviewId },
          actor: { type: 'user', id: userId },
          payload: { reviewId, productId: review.productId, userId },
        });
      },
      { name: 'review.delete', preset: 'short' },
    );

    await this.invalidateProductReviewsCache(review.productId);
  }

  private async invalidateProductReviewsCache(
    productId: string,
  ): Promise<void> {
    await Promise.all(
      productReviewsCacheKeys(productId).map((key) =>
        this.cacheService.del(key),
      ),
    );
  }

  private toResponseDto(review: ReviewWithUser): ReviewResponseDto {
    return {
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      productId: review.productId,
      userId: review.userId,
      userFirstName: review.user?.firstName,
      userLastName: review.user?.lastName,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    };
  }
}
