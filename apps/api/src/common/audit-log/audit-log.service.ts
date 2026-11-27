import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { IncomingMessage } from 'http';
import { RabbitMQService } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.service';
import { RABBITMQ_ROUTING_KEYS } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { currentProcessRole } from '@api/config/process-role';
import { currentRequestId } from '@api/common/request-context/request-context';
import {
  extractIpAddress,
  extractUserAgent,
} from '@api/common/utils/request.util';
import { AuditWriter } from './audit-writer';
import { buildAuditEvent, type AuditEvent } from './audit-event';

export type AuditPayload = Prisma.InputJsonValue | typeof Prisma.JsonNull;

type Primitive = string | number | boolean | null;
type JsonValue = Primitive | JsonValue[] | { [key: string]: JsonValue };

/** Structured diff for update audit logs: { fieldName: { old, new } } */
export type AuditChanges = Record<string, { old: JsonValue; new: JsonValue }>;

/** Helper to tag a raw object as a valid audit payload (avoids TS type-complexity issues with Prisma.InputJsonValue) */
export function toAuditPayload(value: Record<string, unknown>): AuditPayload {
  return value as AuditPayload;
}

export interface AuditLogParams {
  action: string;
  entity: string;
  entityId?: string;
  payload?: AuditPayload;
  adminId?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  outcome?: 'success' | 'failure';
  statusCode?: number;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

/** Events held in memory while the broker is unavailable. */
export const AUDIT_FALLBACK_LIMIT = 5_000;
export const AUDIT_FALLBACK_FLUSH_MS = 1_000;

/**
 * Records audit events without making the caller wait.
 *
 * `log()` and `record()` return as soon as the event is handed off:
 *  1. normally it is published to RabbitMQ (persistent, with publisher
 *     confirms) and a worker writes it in batches;
 *  2. if the broker is unavailable it is held in a bounded in-memory buffer and
 *     written straight to the database every second.
 *
 * Critical changes (money, permissions, sign-in) should instead use
 * `TransactionContext.audit(...)`, which writes the event to the outbox inside
 * the same database transaction as the change, so it cannot be lost.
 */
@Injectable()
export class AuditLogService implements OnModuleDestroy {
  private readonly logger = new Logger(AuditLogService.name);
  private fallback: AuditEvent[] = [];
  private fallbackTimer: NodeJS.Timeout | null = null;
  private flushing = false;

  constructor(
    private readonly writer: AuditWriter,
    @Optional() private readonly rabbitmq?: RabbitMQService,
  ) {}

  async log(params: AuditLogParams): Promise<void> {
    this.record(
      buildAuditEvent({
        ...params,
        requestId: params.requestId ?? currentRequestId(),
        source: currentProcessRole(),
      }),
    );
    return Promise.resolve();
  }

  /**
   * Convenience method that accepts an optional HTTP request object.
   * IP address and User-Agent are automatically extracted from the request
   * when provided.
   */
  async logWithRequest(
    params: Omit<AuditLogParams, 'ipAddress' | 'userAgent'> & {
      request?: IncomingMessage;
    },
  ): Promise<void> {
    const { request, ...rest } = params;

    await this.log({
      ...rest,
      ipAddress: request ? extractIpAddress(request) : undefined,
      userAgent: request ? extractUserAgent(request) : undefined,
    });
  }

  /** Hands a prepared event to the pipeline. Never throws, never waits. */
  record(event: AuditEvent): void {
    void this.deliver(event);
  }

  private async deliver(event: AuditEvent): Promise<void> {
    try {
      if (
        this.rabbitmq?.isAvailable() &&
        (await this.rabbitmq.publish(RABBITMQ_ROUTING_KEYS.AUDIT_EVENT, event))
      ) {
        return;
      }
    } catch (error) {
      this.logger.warn(
        `Audit publish failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    this.buffer(event);
  }

  private buffer(event: AuditEvent): void {
    if (this.fallback.length >= AUDIT_FALLBACK_LIMIT) {
      // Visible loss beats unbounded memory: drop the oldest and say so.
      this.fallback.shift();
      this.logger.error(
        `Audit fallback buffer full (${AUDIT_FALLBACK_LIMIT}); dropped the oldest event.`,
      );
    }
    this.fallback.push(event);
    this.fallbackTimer ??= setTimeout(() => {
      this.fallbackTimer = null;
      void this.flushFallback();
    }, AUDIT_FALLBACK_FLUSH_MS);
  }

  async flushFallback(): Promise<void> {
    if (this.flushing || this.fallback.length === 0) return;
    this.flushing = true;
    const batch = this.fallback;
    this.fallback = [];
    try {
      await this.writer.writeBatch(batch);
    } catch (error) {
      this.logger.error(
        `Audit fallback write failed for ${batch.length} event(s): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // Keep them for the next attempt, within the bound.
      this.fallback = [...batch, ...this.fallback].slice(-AUDIT_FALLBACK_LIMIT);
      this.fallbackTimer ??= setTimeout(() => {
        this.fallbackTimer = null;
        void this.flushFallback();
      }, AUDIT_FALLBACK_FLUSH_MS * 5);
    } finally {
      this.flushing = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    await this.flushFallback();
  }
}
