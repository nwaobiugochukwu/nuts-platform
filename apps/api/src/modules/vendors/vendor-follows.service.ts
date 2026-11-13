import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { OutboxService } from '@api/infrastructure/outbox/outbox.service';
import { DomainEvents } from '@api/common/events/domain-events';

const FOLLOWED_VENDOR_SELECT = {
  id: true,
  storeName: true,
  storeSlug: true,
  storeDescription: true,
  storeLogoUrl: true,
  isVerified: true,
} as const;

@Injectable()
export class VendorFollowsService {
  private readonly logger = new Logger(VendorFollowsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  list(userId: string) {
    return this.prisma.vendorFollow.findMany({
      where: { userId, vendor: { isActive: true, isApproved: true } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: { createdAt: true, vendor: { select: FOLLOWED_VENDOR_SELECT } },
    });
  }

  async manage(
    userId: string,
    search = '',
    pageValue = '1',
    limitValue = '20',
  ) {
    const page = Math.max(1, Number.parseInt(pageValue, 10) || 1);
    const limit = Math.min(
      50,
      Math.max(1, Number.parseInt(limitValue, 10) || 20),
    );
    const term = search.trim().slice(0, 80);
    const baseWhere: Prisma.VendorFollowWhereInput = {
      userId,
      vendor: { isActive: true, isApproved: true },
    };
    const searchWhere: Prisma.VendorFollowWhereInput = term
      ? {
          ...baseWhere,
          vendor: {
            isActive: true,
            isApproved: true,
            storeName: { contains: term, mode: 'insensitive' },
          },
        }
      : baseWhere;
    const [data, followingCount, matchingCount] = await Promise.all([
      this.prisma.vendorFollow.findMany({
        where: searchWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: { createdAt: true, vendor: { select: FOLLOWED_VENDOR_SELECT } },
      }),
      this.prisma.vendorFollow.count({ where: baseWhere }),
      term
        ? this.prisma.vendorFollow.count({ where: searchWhere })
        : Promise.resolve(undefined),
    ]);
    const matching = matchingCount ?? followingCount;
    return {
      data,
      meta: {
        followingCount,
        matchingCount: matching,
        page,
        limit,
        totalPages: Math.ceil(matching / limit),
      },
    };
  }

  async count(userId: string) {
    const count = await this.prisma.vendorFollow.count({
      where: { userId, vendor: { isActive: true, isApproved: true } },
    });
    return { count };
  }

  async publicFollowerCount(storeSlug: string) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { storeSlug, isActive: true, isApproved: true },
      select: { id: true },
    });
    if (!vendor) throw new NotFoundException('Store not found');
    const count = await this.activeFollowerCount(vendor.id);
    return { count };
  }

  async follow(userId: string, vendorId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const vendor = await tx.vendor.findFirst({
          where: { id: vendorId, isActive: true, isApproved: true },
          select: { id: true },
        });
        if (!vendor) throw new NotFoundException('Vendor store not found');

        const existing = await tx.vendorFollow.findUnique({
          where: { userId_vendorId: { userId, vendorId } },
          select: { id: true },
        });
        if (existing) {
          return {
            following: true,
            changed: false,
            followerCount: await this.activeFollowerCount(vendorId, tx),
          };
        }

        await tx.vendorFollow.create({ data: { userId, vendorId } });
        await tx.recommendationEvent.create({
          data: {
            eventType: 'FOLLOW',
            surface: 'VENDOR_STORE',
            vendorId,
            userId,
          },
        });
        await this.outbox.appendEvent(
          tx,
          'vendor',
          vendorId,
          DomainEvents.VENDOR_FOLLOWED,
          {
            userId,
            vendorId,
          },
        );
        return {
          following: true,
          changed: true,
          followerCount: await this.activeFollowerCount(vendorId, tx),
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.logger.debug(
          `Follow already exists for user ${userId} and store ${vendorId}.`,
        );
        return {
          following: true,
          changed: false,
          followerCount: await this.activeFollowerCount(vendorId),
        };
      }
      throw error;
    }
  }

  async unfollow(userId: string, vendorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.vendorFollow.deleteMany({
        where: { userId, vendorId },
      });
      if (deleted.count > 0) {
        await tx.recommendationEvent.create({
          data: {
            eventType: 'UNFOLLOW',
            surface: 'VENDOR_STORE',
            vendorId,
            userId,
          },
        });
        await this.outbox.appendEvent(
          tx,
          'vendor',
          vendorId,
          DomainEvents.VENDOR_UNFOLLOWED,
          {
            userId,
            vendorId,
          },
        );
      }
      return {
        following: false,
        changed: deleted.count > 0,
        followerCount: await this.activeFollowerCount(vendorId, tx),
      };
    });
  }

  private activeFollowerCount(vendorId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    return client.vendorFollow.count({
      where: { vendorId, user: { isActive: true } },
    });
  }
}
