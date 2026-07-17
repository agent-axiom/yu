export function withBase(path: string, base = import.meta.env.BASE_URL): string {
  const normalizedBase = `/${base.replace(/^\/+|\/+$/g, '')}`;
  const normalizedPath = `/${path.replace(/^\/+/, '')}`;

  if (
    normalizedPath === normalizedBase ||
    normalizedPath.startsWith(`${normalizedBase}/`)
  ) {
    return normalizedPath;
  }

  return `${normalizedBase === '/' ? '' : normalizedBase}${normalizedPath}`;
}
