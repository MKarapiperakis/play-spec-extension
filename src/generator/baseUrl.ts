export function resolveBaseUrl(api: any, override?: string): string {
  if (override) return override;
  if (Array.isArray(api.servers) && api.servers.length && api.servers[0].url) {
    return api.servers[0].url;
  }
  if (api.host) {
    const scheme = (Array.isArray(api.schemes) && api.schemes[0]) || 'https';
    return `${scheme}://${api.host}${api.basePath || ''}`;
  }
  return 'http://localhost:3000';
}
