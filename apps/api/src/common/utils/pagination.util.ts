export function getPagination(page?: number | null, limit?: number | null) {
  const parsedPage = Number(page);
  const parsedLimit = Number(limit);

  const safePage =
    Number.isFinite(parsedPage) && parsedPage > 0 ? Math.floor(parsedPage) : 1;

  const safeLimit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(Math.floor(parsedLimit), 100)
      : 20;

  const skip = (safePage - 1) * safeLimit;

  return {
    skip,
    take: safeLimit,
  };
}
