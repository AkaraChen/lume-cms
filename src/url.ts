export function normalizeBaseUrl(value = '/'): string {
  return new URL(value, 'https://example.com').pathname.replace(/\/+$/u, '') || '/';
}
