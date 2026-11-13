export function resolveProductDetailPath(
  productSlug: string,
  categoryPath?: string,
  href?: string,
): string {
  if (href) return href;

  const productPath = encodeURIComponent(productSlug);
  if (categoryPath) {
    return `${categoryPath.replace(/\/+$/, "")}/${productPath}`;
  }

  return `/product/${productPath}`;
}
