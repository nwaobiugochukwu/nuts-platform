import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RABBITMQ_QUEUES } from './rabbitmq.constants';
import { RabbitMQService } from './rabbitmq.service';
import {
  getErrorMessage,
  getErrorStack,
} from '@api/common/utils/error-details.util';

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
  ) {}

  async onModuleInit() {
    await this.rabbitmq.consume<InventoryQueuePayload>(
      RABBITMQ_QUEUES.INVENTORY,
      async (payload) => {
        try {
          if (!payload || !payload.productId) return;

          const createdAt = payload.timestamp
            ? new Date(payload.timestamp)
            : new Date();

          // Fetch current stock
          const product = await this.prisma.product.findUnique({
            where: { id: payload.productId },
            select: { stock: true },
          });

          if (!product) return;

          const oldStock = product.stock;
          const newStock = Math.max(0, oldStock + payload.adjustment);

          // Update stock and record audit history in a transaction
          await this.prisma.$transaction([
            this.prisma.product.update({
              where: { id: payload.productId },
              data: { stock: newStock },
            }),
            this.prisma.stockHistory.create({
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
            }),
          ]);

          this.logger.log(
            `Adjusted inventory for product ${payload.productId}: ${oldStock} -> ${newStock} (${payload.adjustment})`,
          );
        } catch (err: unknown) {
          this.logger.error(
            `Failed to process inventory adjustment: ${getErrorMessage(err)}`,
            getErrorStack(err),
          );
        }
      },
    );
  }
}
