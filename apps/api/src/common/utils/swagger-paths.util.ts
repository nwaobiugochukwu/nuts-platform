export function removeDuplicateAdminCategoryPaths(
  paths: Record<string, unknown>,
): void {
  for (const path of Object.keys(paths)) {
    const canonicalPath = path.replace(
      /^\/api\/v1\/admin\/category(?=\/|$)/,
      '/api/v1/admin/categories',
    );

    if (canonicalPath !== path && paths[canonicalPath]) {
      delete paths[path];
    }
  }
}
