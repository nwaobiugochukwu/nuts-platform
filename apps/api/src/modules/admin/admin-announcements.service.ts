import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AnnouncementAudience,
  AnnouncementStatus,
  NotificationPriority,
  Prisma,
  ROLE,
} from '@prisma/client';
import {
  AuditLogService,
  toAuditPayload,
} from '@api/common/audit-log/audit-log.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { NotificationsService } from '@api/modules/notifications/notifications.service';
import {
  CreateAdminAnnouncementDto,
  QueryAdminAnnouncementsDto,
  ScheduleAdminAnnouncementDto,
  UpdateAdminAnnouncementDto,
  type CampaignAnnouncementAudience,
} from './dto/admin-announcement.dto';

const DELIVERY_BATCH_SIZE = 200;
const PUBLISH_LEASE_MS = 15 * 60 * 1000;
const ANNOUNCEMENT_DESTINATIONS: Record<
  AnnouncementAudience,
  ReadonlySet<string>
> = {
  [AnnouncementAudience.CUSTOMERS]: new Set([
    '/',
    '/product',
    '/search',
    '/cart',
    '/order',
    '/account/following',
  ]),
  [AnnouncementAudience.VENDORS]: new Set([
    '/vendor/product',
    '/vendor/order',
    '/vendor/analytic',
    '/vendor/discount',
    '/vendor/setting',
    '/vendor/notifications',
    '/vendor/wallet',
  ]),
  // Retained only so existing campaigns remain readable in the audit history.
  [AnnouncementAudience.ADMINISTRATORS]: new Set(),
};

@Injectable()
export class AdminAnnouncementsService {
  private readonly logger = new Logger(AdminAnnouncementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(query: QueryAdminAnnouncementsDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const search = query.search?.trim();
    const where: Prisma.AnnouncementWhereInput = {
      ...(query.audience ? { audience: query.audience } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { message: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.announcement.findMany({
        where,
        include: {
          createdByAdmin: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.announcement.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async getAudienceCounts() {
    const [users, vendors] = await Promise.all([
      this.prisma.user.count({ where: { isActive: true, role: ROLE.USER } }),
      this.prisma.vendor.count({ where: { isActive: true, isApproved: true } }),
    ]);
    return { users, vendors };
  }

  async getOverview() {
    const [audienceCounts, activeCampaigns, published] = await Promise.all([
      this.getAudienceCounts(),
      this.prisma.announcement.count({
        where: {
          status: {
            in: [
              AnnouncementStatus.DRAFT,
              AnnouncementStatus.SCHEDULED,
              AnnouncementStatus.PUBLISHING,
            ],
          },
        },
      }),
      this.prisma.announcement.aggregate({
        where: { status: AnnouncementStatus.PUBLISHED },
        _sum: { recipientCount: true },
      }),
    ]);

    return {
      ...audienceCounts,
      activeCampaigns,
      recipientsReached: published._sum.recipientCount ?? 0,
    };
  }

  async createDraft(
    dto: CreateAdminAnnouncementDto,
    adminId: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    this.assertCampaignAudience(dto.audience);
    const link = dto.link?.trim() || null;
    this.assertDestination(dto.audience, link);

    const announcement = await this.prisma.announcement.create({
      data: {
        title: dto.title.trim(),
        message: dto.message.trim(),
        audience: dto.audience,
        priority: dto.priority ?? NotificationPriority.MEDIUM,
        link,
        createdByAdminId: adminId,
      },
    });

    await this.auditLog.log({
      action: 'ANNOUNCEMENT_DRAFT_CREATED',
      entity: 'Announcement',
      entityId: announcement.id,
      adminId,
      payload: toAuditPayload({
        title: announcement.title,
        audience: announcement.audience,
      }),
      ipAddress,
      userAgent,
    });
    return announcement;
  }

  async updateDraft(
    id: string,
    dto: UpdateAdminAnnouncementDto,
    adminId: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const current = await this.getAnnouncementOrThrow(id);
    this.assertEditable(current.status);
    const audience = dto.audience ?? current.audience;
    const link =
      dto.link !== undefined ? dto.link?.trim() || null : current.link;
    this.assertCampaignAudience(audience);
    this.assertDestination(audience, link);

    const updated = await this.prisma.announcement.updateMany({
      where: {
        id,
        status: {
          in: [AnnouncementStatus.DRAFT, AnnouncementStatus.SCHEDULED],
        },
      },
      data: {
        status: AnnouncementStatus.DRAFT,
        scheduledAt: null,
        lastError: null,
        ...(dto.title !== undefined && { title: dto.title.trim() }),
        ...(dto.message !== undefined && { message: dto.message.trim() }),
        ...(dto.audience !== undefined && { audience: dto.audience }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.link !== undefined && { link: dto.link?.trim() || null }),
      },
    });
    if (updated.count === 0) {
      throw new ConflictException(
        'The announcement changed before it could be updated',
      );
    }
    const saved = await this.getAnnouncementOrThrow(id);

    await this.auditLog.log({
      action: 'ANNOUNCEMENT_DRAFT_UPDATED',
      entity: 'Announcement',
      entityId: saved.id,
      adminId,
      payload: toAuditPayload({
        status: saved.status,
        audience: saved.audience,
      }),
      ipAddress,
      userAgent,
    });
    return saved;
  }

  async schedule(
    id: string,
    dto: ScheduleAdminAnnouncementDto,
    adminId: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const scheduledAt = new Date(dto.scheduledAt);
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt <= new Date()) {
      throw new BadRequestException(
        'Choose a future date and time to schedule this announcement',
      );
    }

    const current = await this.getAnnouncementOrThrow(id);
    this.assertEditable(current.status);
    this.assertCampaignAudience(current.audience);
    this.assertDestination(current.audience, current.link);

    const scheduled = await this.prisma.announcement.updateMany({
      where: {
        id,
        status: {
          in: [AnnouncementStatus.DRAFT, AnnouncementStatus.SCHEDULED],
        },
      },
      data: {
        status: AnnouncementStatus.SCHEDULED,
        scheduledAt,
        processingAt: null,
        lastError: null,
      },
    });
    if (scheduled.count === 0) {
      throw new ConflictException(
        'The announcement changed before it could be scheduled',
      );
    }
    const saved = await this.getAnnouncementOrThrow(id);

    await this.auditLog.log({
      action: 'ANNOUNCEMENT_SCHEDULED',
      entity: 'Announcement',
      entityId: id,
      adminId,
      payload: toAuditPayload({ scheduledAt: scheduledAt.toISOString() }),
      ipAddress,
      userAgent,
    });
    return saved;
  }

  async publishNow(
    id: string,
    adminId: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const current = await this.getAnnouncementOrThrow(id);
    this.assertCampaignAudience(current.audience);
    this.assertDestination(current.audience, current.link);
    if (current.status === AnnouncementStatus.PUBLISHING) return current;
    if (
      current.status === AnnouncementStatus.PUBLISHED ||
      current.status === AnnouncementStatus.ARCHIVED
    ) {
      throw new ConflictException(
        'This announcement can no longer be published',
      );
    }

    const claimed = await this.prisma.announcement.updateMany({
      where: {
        id,
        status: {
          in: [
            AnnouncementStatus.DRAFT,
            AnnouncementStatus.SCHEDULED,
            AnnouncementStatus.FAILED,
          ],
        },
      },
      data: {
        status: AnnouncementStatus.PUBLISHING,
        scheduledAt: null,
        processingAt: new Date(),
        lastError: null,
      },
    });

    if (claimed.count === 0) {
      const latest = await this.getAnnouncementOrThrow(id);
      if (latest.status === AnnouncementStatus.PUBLISHING) return latest;
      throw new ConflictException(
        'The announcement status changed before it could be published',
      );
    }

    await this.auditLog.log({
      action: 'ANNOUNCEMENT_PUBLISH_STARTED',
      entity: 'Announcement',
      entityId: id,
      adminId,
      payload: toAuditPayload({ audience: current.audience }),
      ipAddress,
      userAgent,
    });

    this.startDelivery(id);
    return this.getAnnouncementOrThrow(id);
  }

  async archive(
    id: string,
    adminId: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const current = await this.getAnnouncementOrThrow(id);
    if (
      current.status === AnnouncementStatus.PUBLISHING ||
      current.status === AnnouncementStatus.ARCHIVED
    ) {
      throw new ConflictException(
        'This announcement cannot be archived in its current state',
      );
    }

    const archived = await this.prisma.announcement.updateMany({
      where: {
        id,
        status: {
          in: [
            AnnouncementStatus.DRAFT,
            AnnouncementStatus.SCHEDULED,
            AnnouncementStatus.PUBLISHED,
            AnnouncementStatus.FAILED,
          ],
        },
      },
      data: {
        status: AnnouncementStatus.ARCHIVED,
        scheduledAt: null,
      },
    });
    if (archived.count === 0) {
      throw new ConflictException(
        'The announcement changed before it could be archived',
      );
    }
    const saved = await this.getAnnouncementOrThrow(id);
    await this.auditLog.log({
      action: 'ANNOUNCEMENT_ARCHIVED',
      entity: 'Announcement',
      entityId: id,
      adminId,
      payload: toAuditPayload({ previousStatus: current.status }),
      ipAddress,
      userAgent,
    });
    return saved;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processScheduledAnnouncements(): Promise<void> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - PUBLISH_LEASE_MS);
    const [due, stale] = await Promise.all([
      this.prisma.announcement.findMany({
        where: {
          status: AnnouncementStatus.SCHEDULED,
          scheduledAt: { lte: now },
        },
        select: { id: true },
        orderBy: { scheduledAt: 'asc' },
        take: 10,
      }),
      this.prisma.announcement.findMany({
        where: {
          status: AnnouncementStatus.PUBLISHING,
          processingAt: { lt: staleBefore },
        },
        select: { id: true, processingAt: true },
        orderBy: { processingAt: 'asc' },
        take: 10,
      }),
    ]);

    for (const announcement of due) {
      const claimed = await this.prisma.announcement.updateMany({
        where: {
          id: announcement.id,
          status: AnnouncementStatus.SCHEDULED,
          scheduledAt: { lte: now },
        },
        data: {
          status: AnnouncementStatus.PUBLISHING,
          processingAt: now,
          lastError: null,
        },
      });
      if (claimed.count > 0) this.startDelivery(announcement.id);
    }

    for (const announcement of stale) {
      if (!announcement.processingAt) continue;
      const claimed = await this.prisma.announcement.updateMany({
        where: {
          id: announcement.id,
          status: AnnouncementStatus.PUBLISHING,
          processingAt: announcement.processingAt,
        },
        data: { processingAt: now },
      });
      if (claimed.count > 0) this.startDelivery(announcement.id);
    }
  }

  private startDelivery(id: string): void {
    void this.deliver(id);
  }

  private async deliver(id: string): Promise<void> {
    try {
      const announcement = await this.getAnnouncementOrThrow(id);
      if (announcement.status !== AnnouncementStatus.PUBLISHING) return;

      this.assertCampaignAudience(announcement.audience);
      this.assertDestination(announcement.audience, announcement.link);
      const role: Extract<ROLE, 'USER' | 'VENDOR'> =
        announcement.audience === AnnouncementAudience.CUSTOMERS
          ? ROLE.USER
          : ROLE.VENDOR;
      let lastId: string | undefined;

      while (true) {
        const recipients =
          role === ROLE.USER
            ? await this.prisma.user.findMany({
                where: {
                  isActive: true,
                  role: ROLE.USER,
                  ...(lastId ? { id: { gt: lastId } } : {}),
                },
                select: { id: true },
                orderBy: { id: 'asc' },
                take: DELIVERY_BATCH_SIZE,
              })
            : await this.prisma.vendor.findMany({
                where: {
                  isActive: true,
                  isApproved: true,
                  ...(lastId ? { id: { gt: lastId } } : {}),
                },
                select: { id: true },
                orderBy: { id: 'asc' },
                take: DELIVERY_BATCH_SIZE,
              });

        if (recipients.length === 0) break;

        await this.notifications.createAnnouncementBatch({
          announcementId: announcement.id,
          recipients: recipients.map(({ id: recipientId }) => recipientId),
          role,
          title: announcement.title,
          message: announcement.message,
          priority: announcement.priority,
          link: announcement.link,
        });

        lastId = recipients[recipients.length - 1].id;
        await this.prisma.announcement.updateMany({
          where: { id, status: AnnouncementStatus.PUBLISHING },
          data: { processingAt: new Date() },
        });
        if (recipients.length < DELIVERY_BATCH_SIZE) break;
      }

      const recipientCount = await this.prisma.notification.count({
        where: {
          dedupeKey: {
            startsWith: `announcement:${announcement.id}:${role}:`,
          },
        },
      });
      const publishedAt = new Date();
      const completed = await this.prisma.announcement.updateMany({
        where: { id, status: AnnouncementStatus.PUBLISHING },
        data: {
          status: AnnouncementStatus.PUBLISHED,
          publishedAt,
          processingAt: null,
          recipientCount,
          lastError: null,
        },
      });

      if (completed.count > 0) {
        await this.auditLog.log({
          action: 'ANNOUNCEMENT_PUBLISHED',
          entity: 'Announcement',
          entityId: id,
          adminId: announcement.createdByAdminId ?? undefined,
          payload: toAuditPayload({
            audience: announcement.audience,
            recipientCount,
          }),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Announcement ${id} delivery failed: ${message}`);
      try {
        await this.prisma.announcement.updateMany({
          where: { id, status: AnnouncementStatus.PUBLISHING },
          data: {
            status: AnnouncementStatus.FAILED,
            processingAt: null,
            lastError: message.slice(0, 1000),
          },
        });
      } catch (persistenceError) {
        this.logger.error(
          `Could not mark announcement ${id} as failed: ${persistenceError instanceof Error ? persistenceError.message : String(persistenceError)}`,
        );
      }
      await this.auditLog.log({
        action: 'ANNOUNCEMENT_DELIVERY_FAILED',
        entity: 'Announcement',
        entityId: id,
        payload: toAuditPayload({ error: message.slice(0, 500) }),
      });
    }
  }

  private async getAnnouncementOrThrow(id: string) {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id },
    });
    if (!announcement) throw new NotFoundException('Announcement not found');
    return announcement;
  }

  private assertEditable(status: AnnouncementStatus): void {
    if (
      status !== AnnouncementStatus.DRAFT &&
      status !== AnnouncementStatus.SCHEDULED
    ) {
      throw new ConflictException(
        'Only draft or scheduled announcements can be edited',
      );
    }
  }

  private assertCampaignAudience(
    audience: AnnouncementAudience,
  ): asserts audience is CampaignAnnouncementAudience {
    if (
      audience !== AnnouncementAudience.CUSTOMERS &&
      audience !== AnnouncementAudience.VENDORS
    ) {
      throw new BadRequestException(
        'Administrator campaign audiences are retired. Choose customers or vendors before scheduling or publishing.',
      );
    }
  }

  private assertDestination(
    audience: AnnouncementAudience,
    link: string | null | undefined,
  ): void {
    if (!link) return;
    if (!ANNOUNCEMENT_DESTINATIONS[audience].has(link)) {
      throw new BadRequestException(
        'Choose an in-app destination available to the selected audience.',
      );
    }
  }
}
