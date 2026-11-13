export function normalizeWildcardPath(path: string): string {
  if (!path || typeof path !== 'string') return '';

  return path
    .trim()
    .replace(/,/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('/');
}
