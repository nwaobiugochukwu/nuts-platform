import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import type { AuditEvent } from './audit-event';

type AuditRow = Prisma.AuditLogCreateManyInput;

export function toAuditRow(event: AuditEvent): AuditRow {
  return {
    eventId: event.eventId,
    occurredAt: new Date(event.occurredAt),
    action: event.action,
    entity: event.entity,
    entityId: event.entityId,
    adminId: event.adminId,
    userId: event.userId,
    ipAddress: event.ipAddress,
    userAgent: event.userAgent,
    requestId: event.requestId,
    outcome: event.outcome,
    statusCode: event.statusCode,
    source: event.source,
    payload: event.payload,
    before: event.before,
    after: event.after,
  };
}

/** Writes audit events to the append-only audit_logs table. Idempotent on eventId. */
@Injectable()
export class AuditWriter {
  private readonly logger = new Logger(AuditWriter.name);

  constructor(private readonly prisma: PrismaService) {}

  async writeBatch(events: AuditEvent[]): Promise<void> {
    if (events.length === 0) return;
    const rows = events.map(toAuditRow);
    try {
      await this.prisma.auditLog.createMany({
        data: rows,
        skipDuplicates: true,
      });
      return;
    } catch (error) {
      this.logger.warn(
        `Audit batch of ${rows.length} failed (${
          error instanceof Error ? error.message : String(error)
        }); retrying row by row.`,
      );
    }
    // One bad row (for example an actor that no longer exists) must not lose
    // the others.
    let failed = 0;
    for (const row of rows) {
      try {
        await this.prisma.auditLog.createMany({
          data: [row],
          skipDuplicates: true,
        });
      } catch (error) {
        if (isForeignKeyViolation(error) && (row.adminId || row.userId)) {
          try {
            await this.prisma.auditLog.createMany({
              data: [
                {
                  ...row,
                  adminId: null,
                  userId: null,
                  payload: {
                    ...(isObject(row.payload) ? row.payload : {}),
                    actorRef: { adminId: row.adminId, userId: row.userId },
                  },
                },
              ],
              skipDuplicates: true,
            });
            continue;
          } catch {
            // fall through to the failure count
          }
        }
        failed += 1;
        this.logger.error(
          `Audit event ${row.eventId ?? '?'} (${row.action}) could not be stored: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    if (failed > 0) {
      throw new Error(`${failed} audit event(s) could not be stored`);
    }
  }
}

function isForeignKeyViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2003'
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
