import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Puts the stock of every item of an order back, in a stable order so concurrent restores cannot deadlock. */
export async function restoreOrderStock(
  tx: Prisma.TransactionClient,
  orderItems: Array<{
    productId: string;
    variantId: string | null;
    quantity: number;
  }>,
  description: string,
): Promise<void> {
  const rows: Prisma.StockHistoryCreateManyInput[] = [];

  const sorted = [...orderItems].sort((a, b) =>
    (a.variantId ?? a.productId).localeCompare(b.variantId ?? b.productId),
  );

  for (const item of sorted) {
    if (item.variantId) {
      const result = await tx.$queryRaw<
        Array<{
          id: string;
          productId: string;
          oldStock: number;
          newStock: number;
        }>
      >(
        Prisma.sql`
            UPDATE "product_variants"
            SET
              "stock" = "stock" + ${item.quantity},
              "updatedAt" = NOW()
            WHERE "id" = ${item.variantId}
            RETURNING
              "id",
              "productId",
              ("stock" - ${item.quantity}) AS "oldStock",
              "stock" AS "newStock"
          `,
      );

      if (result.length !== 1) {
        throw new ConflictException(
          `Unable to restore stock for variant ${item.variantId}.`,
        );
      }

      rows.push({
        productId: result[0].productId,

        variantId: result[0].id,

        adjustment: item.quantity,

        oldStockQuantity: result[0].oldStock,

        newStockQuantity: result[0].newStock,

        description,
      });
    } else {
      const result = await tx.$queryRaw<
        Array<{
          id: string;
          oldStock: number;
          newStock: number;
        }>
      >(
        Prisma.sql`
            UPDATE "products"
            SET
              "stock" = "stock" + ${item.quantity},
              "updatedAt" = NOW()
            WHERE "id" = ${item.productId}
            RETURNING
              "id",
              ("stock" - ${item.quantity}) AS "oldStock",
              "stock" AS "newStock"
          `,
      );

      if (result.length !== 1) {
        throw new ConflictException(
          `Unable to restore stock for product ${item.productId}.`,
        );
      }

      rows.push({
        productId: result[0].id,

        adjustment: item.quantity,

        oldStockQuantity: result[0].oldStock,

        newStockQuantity: result[0].newStock,

        description,
      });
    }
  }

  if (rows.length) {
    await tx.stockHistory.createMany({
      data: rows,
    });
  }
}
