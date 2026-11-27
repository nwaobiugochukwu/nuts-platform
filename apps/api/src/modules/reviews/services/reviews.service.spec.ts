import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FakeTransactionRunner } from '@api/infrastructure/database/fake-transaction-runner-spec';
import { ReviewsService } from './reviews.service';

describe('ReviewsService', () => {
  let tx: { review: { create: jest.Mock; update: jest.Mock } };
  let prisma: {
    order: { findFirst: jest.Mock };
    review: { findUnique: jest.Mock; findMany: jest.Mock };
    product: { findUnique: jest.Mock };
  };
  let cache: { del: jest.Mock; wrap: jest.Mock };
  let runner: FakeTransactionRunner;
  let service: ReviewsService;

  const created = {
    id: 'r-1',
    rating: 4,
    comment: 'Great',
    productId: 'p-1',
    userId: 'u-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    user: { firstName: 'Ada', lastName: 'Obi' },
  };

  beforeEach(() => {
    tx = {
      review: {
        create: jest.fn().mockResolvedValue(created),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    prisma = {
      order: { findFirst: jest.fn().mockResolvedValue({ id: 'o-1' }) },
      review: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      product: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    cache = {
      del: jest.fn().mockResolvedValue(undefined),
      wrap: jest.fn((_key: string, _ttl: number, fn: () => Promise<unknown>) =>
        fn(),
      ),
    };
    runner = new FakeTransactionRunner(tx);
    service = new ReviewsService(
      prisma as never,
      cache as never,
      runner as never,
    );
  });

  describe('create', () => {
    const dto = { productId: 'p-1', rating: 4, comment: 'Great' };

    it('writes the review and publishes review.created in the same transaction', async () => {
      const result = await service.create('u-1', dto);

      expect(runner.runs).toEqual(['review.create']);
      expect(tx.review.create).toHaveBeenCalledTimes(1);
      expect(runner.published).toEqual([
        {
          type: 'review.created',
          aggregate: { type: 'review', id: 'r-1' },
          actor: { type: 'user', id: 'u-1' },
          payload: {
            reviewId: 'r-1',
            productId: 'p-1',
            userId: 'u-1',
            rating: 4,
          },
        },
      ]);
      expect(result).toMatchObject({ id: 'r-1', rating: 4 });
    });

    it('still clears the cached review list at once, so the reviewer sees their own review', async () => {
      await service.create('u-1', dto);

      expect(cache.del).toHaveBeenCalledWith('product:reviews:p-1');
      expect(cache.del).toHaveBeenCalledWith('product:reviews:p-1:v2');
    });

    it('turns a duplicate review into a conflict and publishes nothing', async () => {
      tx.review.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(service.create('u-1', dto)).rejects.toThrow(
        ConflictException,
      );
      expect(runner.published).toHaveLength(0);
    });

    it('refuses a review from someone who has not received the product', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(service.create('u-1', dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(tx.review.create).not.toHaveBeenCalled();
      expect(runner.published).toHaveLength(0);
    });
  });

  describe('remove', () => {
    it('hides the review and publishes review.deleted in the same transaction', async () => {
      prisma.review.findUnique.mockResolvedValue({
        userId: 'u-1',
        productId: 'p-1',
        isActive: true,
      });

      await service.remove('u-1', 'r-1');

      expect(runner.runs).toEqual(['review.delete']);
      expect(tx.review.update).toHaveBeenCalledWith({
        where: { id: 'r-1' },
        data: { isActive: false },
      });
      expect(runner.published).toEqual([
        expect.objectContaining({
          type: 'review.deleted',
          payload: { reviewId: 'r-1', productId: 'p-1', userId: 'u-1' },
        }),
      ]);
    });

    it('does nothing for a review that is already removed (delete is idempotent)', async () => {
      prisma.review.findUnique.mockResolvedValue({
        userId: 'u-1',
        productId: 'p-1',
        isActive: false,
      });

      await service.remove('u-1', 'r-1');

      expect(runner.published).toHaveLength(0);
    });

    it("refuses to remove someone else's review, and a missing one", async () => {
      prisma.review.findUnique.mockResolvedValue({
        userId: 'other',
        productId: 'p-1',
        isActive: true,
      });
      await expect(service.remove('u-1', 'r-1')).rejects.toThrow(
        ForbiddenException,
      );

      prisma.review.findUnique.mockResolvedValue(null);
      await expect(service.remove('u-1', 'r-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(runner.published).toHaveLength(0);
    });
  });

  describe('findByProduct', () => {
    it('reports the stored summary, which counts every review, not just the page returned', async () => {
      prisma.review.findMany.mockResolvedValue([
        { ...created, isActive: true },
      ]);
      prisma.product.findUnique.mockResolvedValue({
        ratingCount: 250,
        ratingAverage: 4.4,
        ratingBreakdown: { 1: 5, 2: 5, 3: 20, 4: 70, 5: 150 },
      });

      const result = await service.findByProduct('p-1');

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        total: 250,
        averageRating: 4.4,
        ratingBreakdown: { 1: 5, 2: 5, 3: 20, 4: 70, 5: 150 },
      });
    });

    it('reports an empty breakdown for a product with no reviews yet', async () => {
      prisma.product.findUnique.mockResolvedValue({
        ratingCount: 0,
        ratingAverage: 0,
        ratingBreakdown: null,
      });

      const result = await service.findByProduct('p-1');

      expect(result.meta).toEqual({
        total: 0,
        averageRating: 0,
        ratingBreakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      });
    });
  });
});
