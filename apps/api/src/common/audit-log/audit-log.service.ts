import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { IncomingMessage } from 'http';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import {
  extractIpAddress,
  extractUserAgent,
} from '@api/common/utils/request.util';

export type AuditPayload = Prisma.InputJsonValue | typeof Prisma.JsonNull;

type Primitive = string | number | boolean | null;
type JsonValue = Primitive | JsonValue[] | { [key: string]: JsonValue };

/** Structured diff for update audit logs: { fieldName: { old, new } } */
export type AuditChanges = Record<string, { old: JsonValue; new: JsonValue }>;

/** Helper to tag a raw object as a valid audit payload (avoids TS type-complexity issues with Prisma.InputJsonValue) */
export function toAuditPayload(value: Record<string, unknown>): AuditPayload {
  return value as AuditPayload;
}

type AuditLogDelegate = {
  create: (args: {
    data: {
      action: string;
      entity: string;
      entityId?: string;
      payload: AuditPayload;
      adminId?: string;
      userId?: string;
      ipAddress?: string;
      userAgent?: string;
    };
  }) => Promise<unknown>;
};

export interface AuditLogParams {
  action: string;
  entity: string;
  entityId?: string;
  payload?: AuditPayload;
  adminId?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(params: AuditLogParams): Promise<void> {
    const auditLog = (this.prisma as unknown as { auditLog: AuditLogDelegate })
      .auditLog;

    try {
      await auditLog.create({
        data: {
          action: params.action,
          entity: params.entity,
          entityId: params.entityId,
          payload: params.payload ?? Prisma.JsonNull,
          adminId: params.adminId,
          userId: params.userId,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        },
      });
    } catch (error: unknown) {
      this.logger.error({ err: error }, 'Audit log creation failed');
    }
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
}
