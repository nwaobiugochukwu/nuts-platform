import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  MessageEvent,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import {
  NotificationPriority,
  NotificationType,
  Prisma,
  ROLE,
} from '@prisma/client';
import type Redis from 'ioredis';
import {
  filter,
  from,
  interval,
  map,
  merge,
  Observable,
  Subject,
  switchMap,
} from 'rxjs';
import {
  buildCursorMeta,
  buildCursorWhere,
  getCursorPagination,
  type CursorPaginationMetaDto,
} from '@api/common/utils/cursor-pagination.util';
import { REDIS_CLIENT } from '@api/infrastructure/redis/redis.constants';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { AuthSessionService } from '../auth/sessions/auth-session.service';
import { getErrorMessage } from '@api/common/utils/error-details.util';

import { randomUUID } from 'node:crypto';
import { WebPushService } from './push/push.service';
import {
  NotificationPreferencesService,
  NotificationCategory,
} from './preferences/preferences.service';

export interface CreateNotificationDto {
  userId: string;
  role?: ROLE;
  type: NotificationType;
  title: string;
  message: string;
  priority?: NotificationPriority;
  link?: string;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
}

export interface NotificationSseEvent {
  originInstanceId?: string;
  userId: string;
  role: ROLE;
  notification: Prisma.NotificationGetPayload<Record<string, never>>;
}

export const NOTIFICATION_REDIS_CHANNEL = 'nuts:notifications:broadcast';
export const MAX_CONCURRENT_SSE_CONNECTIONS = 5;

function mapTypeToCategory(type: NotificationType): NotificationCategory {
  switch (type) {
    case NotificationType.ORDER_PLACED:
    case NotificationType.ORDER_CONFIRMED:
    case NotificationType.ORDER_SHIPPED:
    case NotificationType.ORDER_DELIVERED:
    case NotificationType.ORDER_CANCELLED:
      return 'orderUpdates';
    case NotificationType.PAYMENT_RECEIVED:
    case NotificationType.PAYMENT_FAILED:
    case NotificationType.PAYMENT_REFUNDED:
    case NotificationType.PAYOUT_PROCESSED:
      return 'paymentAlerts';
    case NotificationType.LOW_STOCK_ALERT:
    case NotificationType.PRICE_DROP:
    case NotificationType.RESTOCKED:
      return 'inventoryAlerts';
    case NotificationType.VENDOR_FOLLOWED:
      return 'socialUpdates';
    case NotificationType.SYSTEM_ANNOUNCEMENT:
    default:
      return 'marketingPromos';
  }
}

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly instanceId = randomUUID();
  private readonly sseSubject = new Subject<NotificationSseEvent>();
  private subClient: Redis | null = null;
  private readonly inMemoryConnectionCounts = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
    @Optional() private readonly authSessionService?: AuthSessionService,
    @Optional() private readonly webPushService?: WebPushService,
    @Optional()
    private readonly preferencesService?: NotificationPreferencesService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.redis) return;

    try {
      this.subClient = this.redis.duplicate();
      this.subClient.on('error', (err) => {
        this.logger.warn(
          `Redis notification pub/sub subscriber error: ${getErrorMessage(err)}`,
        );
      });
      await this.subClient.subscribe(NOTIFICATION_REDIS_CHANNEL);

      this.subClient.on('message', (channel, message) => {
        if (channel !== NOTIFICATION_REDIS_CHANNEL) return;
        try {
          const parsed = JSON.parse(message) as NotificationSseEvent;
          // Prevent local pod duplicate emission: ignore events published by our own instance
          if (parsed && parsed.originInstanceId === this.instanceId) {
            return;
          }
          if (parsed && parsed.userId && parsed.notification) {
            this.sseSubject.next(parsed);
          }
        } catch (err) {
          this.logger.warn(
            `Failed to parse Redis notification pub/sub payload: ${getErrorMessage(err)}`,
          );
        }
      });

      this.logger.log(
        `Notification Redis Pub/Sub subscriber connected [instance: ${this.instanceId}].`,
      );
    } catch (err) {
      this.logger.warn(
        `Redis pub/sub initialization failed: ${getErrorMessage(err)}. Falling back to in-memory broadcast.`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subClient) {
      try {
        await this.subClient.unsubscribe(NOTIFICATION_REDIS_CHANNEL);
        await this.subClient.quit();
      } catch {
        // Ignore during shutdown
      }
      this.subClient = null;
    }
    this.sseSubject.complete();
  }

  /**
   * Broadcasts a notification locally and to all horizontally scaled nodes via Redis Pub/Sub.
   */
  private broadcastNotification(
    userId: string,
    role: ROLE,
    notification: Prisma.NotificationGetPayload<Record<string, never>>,
  ): void {
    const event: NotificationSseEvent = {
      originInstanceId: this.instanceId,
      userId,
      role,
      notification,
    };

    // 1. Emit to local pod subscribers immediately
    this.sseSubject.next(event);

    // 2. Publish to cluster nodes via Redis
    if (this.redis) {
      this.redis
        .publish(NOTIFICATION_REDIS_CHANNEL, JSON.stringify(event))
        .catch((err) => {
          this.logger.warn(
            `Failed to publish notification to Redis cluster: ${getErrorMessage(err)}`,
          );
        });
    }
  }

  /**
   * Dispatches push notification asynchronously if user preferences permit.
   */
  private dispatchPushIfAllowed(
    dto: CreateNotificationDto,
    role: ROLE,
    category: NotificationCategory,
    notificationId?: string,
  ): void {
    if (!this.webPushService) return;

    (async () => {
      try {
        if (this.preferencesService) {
          const canSendPush = await this.preferencesService.canSend(
            dto.userId,
            role,
            'push',
            category,
          );
          if (!canSendPush) return;
        }

        if (!this.webPushService) return;

        await this.webPushService.sendToUser(dto.userId, role, {
          title: dto.title,
          body: dto.message,
          icon: '/icon-192x192.png',
          url: dto.link ?? '/',
          data: {
            notificationId,
            type: dto.type,
            category,
          },
        });
      } catch (err) {
        this.logger.warn(
          `Background WebPush dispatch failed for user ${dto.userId}: ${getErrorMessage(err)}`,
        );
      }
    })().catch(() => undefined);
  }

  /**
   * Fetches missed notifications for replay when an SSE client reconnects with Last-Event-ID.
   */
  async getReplayNotifications(
    userId: string,
    role: ROLE,
    lastEventId: string,
  ): Promise<Prisma.NotificationGetPayload<Record<string, never>>[]> {
    try {
      const refNotification = await this.prisma.notification.findUnique({
        where: { id: lastEventId },
        select: { createdAt: true },
      });

      if (refNotification) {
        return await this.prisma.notification.findMany({
          where: {
            userId,
            role,
            createdAt: { gt: refNotification.createdAt },
          },
          orderBy: { createdAt: 'asc' },
          take: 50,
        });
      }

      // If reference notification not found, return unread notifications
      return await this.prisma.notification.findMany({
        where: {
          userId,
          role,
          isRead: false,
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
    } catch (err) {
      this.logger.warn(
        `Failed retrieving SSE replay notifications for ${userId}: ${getErrorMessage(err)}`,
      );
      return [];
    }
  }

  /**
   * Creates a notification with atomic deduplication.
   * If a notification with the same dedupeKey already exists, returns it without duplicating or re-broadcasting.
   */
  async create(dto: CreateNotificationDto) {
    const role = dto.role ?? ROLE.USER;
    const category = mapTypeToCategory(dto.type);

    if (this.preferencesService) {
      const canSendInApp = await this.preferencesService.canSend(
        dto.userId,
        role,
        'inApp',
        category,
      );
      if (!canSendInApp) {
        this.logger.debug(
          `Skipping in-app notification for ${dto.userId}: opted out of ${category}`,
        );
        this.dispatchPushIfAllowed(dto, role, category);
        return null;
      }
    }

    if (dto.dedupeKey) {
      try {
        const notification = await this.prisma.notification.create({
          data: {
            userId: dto.userId,
            role,
            type: dto.type,
            title: dto.title,
            message: dto.message,
            priority: dto.priority ?? NotificationPriority.MEDIUM,
            link: dto.link,
            metadata: dto.metadata as Prisma.InputJsonValue,
            dedupeKey: dto.dedupeKey,
          },
        });

        this.broadcastNotification(dto.userId, role, notification);
        this.dispatchPushIfAllowed(dto, role, category, notification.id);
        return notification;
      } catch (err: unknown) {
        // P2002: Unique constraint violation on dedupeKey -> return existing row safely
        if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code: string }).code === 'P2002'
        ) {
          const existing = await this.prisma.notification.findUnique({
            where: { dedupeKey: dto.dedupeKey },
          });
          if (existing) {
            return existing;
          }
        }
        throw err;
      }
    }

    const notification = await this.prisma.notification.create({
      data: {
        userId: dto.userId,
        role,
        type: dto.type,
        title: dto.title,
        message: dto.message,
        priority: dto.priority ?? NotificationPriority.MEDIUM,
        link: dto.link,
        metadata: dto.metadata as Prisma.InputJsonValue,
      },
    });

    this.broadcastNotification(dto.userId, role, notification);
    this.dispatchPushIfAllowed(dto, role, category, notification.id);
    return notification;
  }

  /**
   * Batch creates notifications with individual deduplication and real-time broadcast.
   */
  async createMany(dtos: CreateNotificationDto[]) {
    if (!dtos || dtos.length === 0) return [];

    const results = await Promise.allSettled(
      dtos.map((dto) => this.create(dto)),
    );

    return results
      .filter(
        (
          r,
        ): r is PromiseFulfilledResult<
          Prisma.NotificationGetPayload<Record<string, never>>
        > => r.status === 'fulfilled' && r.value !== null,
      )
      .map((r) => r.value);
  }

  /**
   * Delivers an official announcement to one bounded recipient batch.
   * In-app system announcements bypass marketing preferences, use a stable
   * per-recipient dedupe key, and publish only newly inserted rows to SSE.
   */
  async createAnnouncementBatch(input: {
    announcementId: string;
    recipients: string[];
    role: Extract<ROLE, 'USER' | 'ADMIN' | 'VENDOR'>;
    title: string;
    message: string;
    priority: NotificationPriority;
    link?: string | null;
  }): Promise<number> {
    if (input.recipients.length === 0) return 0;

    let createdCount = 0;
    const chunkSize = 200;

    for (
      let offset = 0;
      offset < input.recipients.length;
      offset += chunkSize
    ) {
      const recipientChunk = input.recipients.slice(offset, offset + chunkSize);
      const created = await this.prisma.notification.createManyAndReturn({
        data: recipientChunk.map((userId) => ({
          userId,
          role: input.role,
          type: NotificationType.SYSTEM_ANNOUNCEMENT,
          title: input.title,
          message: input.message,
          priority: input.priority,
          link: input.link ?? undefined,
          metadata: {
            announcementId: input.announcementId,
            audience:
              input.role === ROLE.ADMIN
                ? 'ADMINISTRATORS'
                : input.role === ROLE.VENDOR
                  ? 'VENDORS'
                  : 'CUSTOMERS',
          },
          dedupeKey: `announcement:${input.announcementId}:${input.role}:${userId}`,
        })),
        skipDuplicates: true,
      });

      for (const notification of created) {
        this.broadcastNotification(
          notification.userId,
          notification.role,
          notification,
        );
      }
      createdCount += created.length;
    }

    return createdCount;
  }

  async list(
    userId: string,
    role: ROLE = ROLE.USER,
    params: {
      cursor?: string;
      limit?: number;
      unreadOnly?: boolean;
      type?: NotificationType;
      category?: 'orders' | 'payments';
    } = {},
  ): Promise<{
    data: (Prisma.NotificationGetPayload<Record<string, never>> & {
      actionUrl: string | null;
    })[];
    meta: CursorPaginationMetaDto;
  }> {
    const limit = Math.min(50, Math.max(1, params.limit || 20));
    const { take, decodedCursor } = getCursorPagination(limit, params.cursor);
    const typeFilters: Prisma.NotificationWhereInput[] = [];

    if (params.category === 'orders') {
      typeFilters.push({
        type: {
          in: [
            NotificationType.ORDER_PLACED,
            NotificationType.ORDER_CONFIRMED,
            NotificationType.ORDER_SHIPPED,
            NotificationType.ORDER_DELIVERED,
            NotificationType.ORDER_CANCELLED,
          ],
        },
      });
    } else if (params.category === 'payments') {
      typeFilters.push({
        type: {
          in: [
            NotificationType.PAYMENT_RECEIVED,
            NotificationType.PAYMENT_FAILED,
            NotificationType.PAYMENT_REFUNDED,
            NotificationType.PAYOUT_PROCESSED,
          ],
        },
      });
    }
    if (params.type) {
      typeFilters.push({ type: params.type });
    }

    const where: Prisma.NotificationWhereInput = {
      userId,
      role,
      ...(params.unreadOnly ? { isRead: false } : {}),
      ...(typeFilters.length > 0 ? { AND: typeFilters } : {}),
    };

    const cursorId = decodedCursor?.id;
    const cursorCreatedAt = decodedCursor?.createdAt;
    const cursorDate =
      cursorCreatedAt instanceof Date
        ? cursorCreatedAt
        : typeof cursorCreatedAt === 'string'
          ? new Date(cursorCreatedAt)
          : null;

    if (
      typeof cursorId === 'string' &&
      cursorDate &&
      !Number.isNaN(cursorDate.getTime())
    ) {
      const cursorWhere = buildCursorWhere(
        {
          createdAt: cursorDate,
          id: cursorId,
        },
        'desc',
      );
      where.OR = cursorWhere;
    }

    const fetched = await this.prisma.notification.findMany({
      where,
      select: {
        id: true,
        userId: true,
        role: true,
        type: true,
        title: true,
        message: true,
        priority: true,
        link: true,
        metadata: true,
        dedupeKey: true,
        isRead: true,
        readAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    });

    const meta = buildCursorMeta(fetched, limit, (item) => ({
      createdAt: item.createdAt.toISOString(),
      id: item.id,
    }));

    const data = fetched.slice(0, limit).map((item) => ({
      ...item,
      actionUrl: item.link ?? null,
    }));

    return {
      data,
      meta,
    };
  }

  async getUnreadCount(
    userId: string,
    role: ROLE = ROLE.USER,
  ): Promise<number> {
    return this.prisma.notification.count({
      where: {
        userId,
        role,
        isRead: false,
      },
    });
  }

  async getById(id: string, userId: string, role: ROLE) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId, role },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    return { ...notification, actionUrl: notification.link ?? null };
  }

  /**
   * Marks a notification as read in a single atomic database query.
   * Only updates unread rows, preserving the original readAt timestamp.
   */
  async markAsRead(id: string, userId: string, role: ROLE) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId, role },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.isRead) {
      return { ...notification, actionUrl: notification.link ?? null };
    }

    const updated = await this.prisma.notification.update({
      where: { id },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return { ...updated, actionUrl: updated.link ?? null };
  }

  async markAllAsRead(userId: string, role: ROLE = ROLE.USER) {
    return this.prisma.notification.updateMany({
      where: {
        userId,
        role,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  /**
   * Deletes a notification in a single atomic database query with scoped ownership.
   */
  async delete(id: string, userId: string, role: ROLE) {
    const result = await this.prisma.notification.deleteMany({
      where: { id, userId, role },
    });

    if (result.count === 0) {
      throw new NotFoundException('Notification not found');
    }

    return { success: true };
  }

  async clearAll(userId: string, role: ROLE = ROLE.USER) {
    return this.prisma.notification.deleteMany({
      where: {
        userId,
        role,
        isRead: true,
      },
    });
  }

  /**
   * Tracks connection count and enforces max concurrent streams per user (default 5).
   */
  private tryAcquireConnectionSlot(userId: string, role: ROLE): boolean {
    const connKey = `sse:conn:${role}:${userId}`;
    const current = this.inMemoryConnectionCounts.get(connKey) ?? 0;
    if (current >= MAX_CONCURRENT_SSE_CONNECTIONS) {
      return false;
    }
    this.inMemoryConnectionCounts.set(connKey, current + 1);

    if (this.redis) {
      this.redis
        .incr(connKey)
        .then((count) => {
          void this.redis?.expire(connKey, 3600);
          if (count > MAX_CONCURRENT_SSE_CONNECTIONS) {
            void this.redis?.decr(connKey);
          }
        })
        .catch((err) => {
          this.logger.warn(
            `Redis connection check failed: ${getErrorMessage(err)}`,
          );
        });
    }

    return true;
  }

  private releaseConnectionSlot(userId: string, role: ROLE): void {
    const connKey = `sse:conn:${role}:${userId}`;
    const current = this.inMemoryConnectionCounts.get(connKey) ?? 1;
    if (current <= 1) {
      this.inMemoryConnectionCounts.delete(connKey);
    } else {
      this.inMemoryConnectionCounts.set(connKey, current - 1);
    }

    if (this.redis) {
      this.redis.decr(connKey).catch(() => undefined);
    }
  }

  /**
   * SSE Stream: Emits live notifications for the given userId and role with immediate handshake,
   * message IDs, zero-cost heartbeats, and offline event replay via Last-Event-ID.
   */
  subscribeToUserStream(
    userId: string,
    role: ROLE = ROLE.USER,
    sessionId?: string,
    lastEventId?: string,
  ): Observable<MessageEvent> {
    if (!this.tryAcquireConnectionSlot(userId, role)) {
      throw new HttpException(
        `Too many concurrent notification streams (max ${MAX_CONCURRENT_SSE_CONNECTIONS})`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Filter notifications by both userId AND role
    const notifications$ = this.sseSubject.asObservable().pipe(
      filter((event) => event.userId === userId && event.role === role),
      map((event) => ({
        id: event.notification.id,
        data: event.notification,
      })),
    );

    // Immediate handshake
    const handshake$ = new Observable<MessageEvent>((sub) => {
      sub.next({
        data: { type: 'connected', timestamp: new Date().toISOString() },
      });
      sub.complete();
    });

    // Replay missed notifications if client reconnected with Last-Event-ID
    const replay$ = lastEventId
      ? from(this.getReplayNotifications(userId, role, lastEventId)).pipe(
          switchMap((items) => from(items)),
          map((item) => ({
            id: item.id,
            data: item,
          })),
        )
      : new Observable<MessageEvent>((sub) => sub.complete());

    // 15-second zero-cost heartbeat ping frame (no database query storm)
    const heartbeat$ = interval(15_000).pipe(
      map(() => ({ data: { type: 'ping' } })),
    );

    const merged$ = merge(handshake$, replay$, notifications$, heartbeat$);

    return new Observable<MessageEvent>((subscriber) => {
      const sub = merged$.subscribe(subscriber);

      return () => {
        this.releaseConnectionSlot(userId, role);
        sub.unsubscribe();
      };
    });
  }
}
