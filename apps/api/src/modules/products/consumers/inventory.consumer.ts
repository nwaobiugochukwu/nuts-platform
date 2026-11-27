import { roleCan } from '@api/config/process-role.config';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { RABBITMQ_QUEUES } from '../../../infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { RabbitMQService } from '../../../infrastructure/messaging/rabbitmq/rabbitmq.service';
import { getErrorCode } from '@api/common/utils/error-details.util';
import { ProcessedEventService } from '../../../infrastructure/messaging/idempotency/processed-event.service';

export interface InventoryQueuePayload {
  productId: string;
  variantId?: string | null;
  adjustment: number;
  reason: string;
  createdBy?: string;
  timestamp?: string | number | Date;
}

@Injectable()
export class InventoryConsumer implements OnModuleInit {
  private readonly logger = new Logger(InventoryConsumer.name);

  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly prisma: PrismaService,
    private readonly processed: ProcessedEventService,
  ) {}

  async onModuleInit() {
    // Queue consumers run only in the worker role (or when one process runs everything).
    if (!roleCan('consumers')) return;
    await this.rabbitmq.consume<InventoryQueuePayload>(
      RABBITMQ_QUEUES.INVENTORY,
      async (payload, message) => {
        if (!payload || !payload.productId) return;
        // A redelivered adjustment must not be applied twice.
        await this.processed.runOnce(
          'inventory',
          message?.properties?.messageId as string | undefined,
          () => this.applyAdjustment(payload),
        );
      },
    );
  }

  /**
   * Adds the adjustment with an atomic increment inside one transaction, so two adjustments to
   * the same product (two worker replicas, or two messages in flight) both count. Stock never
   * goes below zero: a result under zero is corrected to zero while the row lock is still held.
   * A failure is thrown, so the queue retries it instead of losing the adjustment.
   */
  private async applyAdjustment(payload: InventoryQueuePayload): Promise<void> {
    const createdAt = payload.timestamp
      ? new Date(payload.timestamp)
      : new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      let raw: number;
      try {
        const updated = await tx.product.update({
          where: { id: payload.productId },
          data: { stock: { increment: payload.adjustment } },
          select: { stock: true },
        });
        raw = updated.stock;
      } catch (err: unknown) {
        if (getErrorCode(err) === 'P2025') return null; // the product no longer exists
        throw err;
      }
      const newStock = Math.max(0, raw);
      if (newStock !== raw) {
        await tx.product.update({
          where: { id: payload.productId },
          data: { stock: newStock },
        });
      }
      const oldStock = raw - payload.adjustment;
      await tx.stockHistory.create({
        data: {
          productId: payload.productId,
          variantId: payload.variantId ?? null,
          adjustment: payload.adjustment,
          oldStockQuantity: oldStock,
          newStockQuantity: newStock,
          description: payload.reason || 'Inventory adjustment',
          createdBy: payload.createdBy ?? 'rabbitmq-inventory-worker',
          createdAt,
        },
      });
      return { oldStock, newStock };
    });

    if (result) {
      this.logger.log(
        `Adjusted inventory for product ${payload.productId}: ${result.oldStock} -> ${result.newStock} (${payload.adjustment})`,
      );
    }
  }
}
