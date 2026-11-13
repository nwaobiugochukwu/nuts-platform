export function getStockStatus(
  stock: number,
  isActive: boolean,
): { inStock: boolean; stockStatus: string } {
  const inStock = isActive && stock > 0;
  let stockStatus = 'Out of stock';

  if (!isActive) {
    stockStatus = 'Inactive';
    return { inStock, stockStatus };
  }

  if (stock > 5) {
    stockStatus = 'In stock';
  } else if (stock > 0) {
    stockStatus = 'Few items left';
  }

  return { inStock, stockStatus };
}
