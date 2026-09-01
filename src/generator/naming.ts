export function toSlug(str: unknown): string {
  return (
    String(str)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'spec'
  );
}

export function toSafeProjectName(str: unknown): string {
  return toSlug(str) || 'openapi-playwright-tests';
}

/** JS string literal, safely escaped. */
export function jsString(value: unknown): string {
  return JSON.stringify(String(value));
}

/** Turns an arbitrary name (e.g. a security scheme name) into a camelCase JS identifier. */
export function toCamelIdentifier(str: unknown): string {
  const parts = String(str)
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (!parts.length) return 'scheme';
  return parts
    .map((p, i) => (i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('');
}

/** Turns an arbitrary name into an UPPER_SNAKE env-var prefix. */
export function toEnvPrefix(str: unknown): string {
  const cleaned = String(str)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'SCHEME';
}

/** Turns an arbitrary name (e.g. a security scheme name) into a PascalCase JS identifier. */
export function toPascalIdentifier(str: unknown): string {
  const camel = toCamelIdentifier(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];
