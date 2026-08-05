export function normalizeBaseUrl(value = '/'): string {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('?') || value.includes('#')) {
    throw new TypeError(`baseUrl must be an absolute pathname, received ${JSON.stringify(value)}`);
  }
  return value.replace(/\/+$/, '') || '/';
}
