export interface SecurityScheme {
  name: string;
  type: 'http-bearer' | 'http-basic' | 'apiKey' | 'unsupported';
  in?: string;
  headerName?: string;
  originalType?: string;
}

/**
 * Extracts security scheme info from an OpenAPI 3.x (components.securitySchemes)
 * or Swagger 2.0 (securityDefinitions) document into a normalized shape:
 *   { name, type: 'http-bearer'|'http-basic'|'apiKey', in, headerName }
 */
export function extractSecuritySchemes(api: any): SecurityScheme[] {
  const raw = (api.components && api.components.securitySchemes) || api.securityDefinitions || {};
  const schemes: SecurityScheme[] = [];

  for (const [name, def] of Object.entries<any>(raw)) {
    if (!def) continue;
    if (def.type === 'http' && def.scheme === 'bearer') {
      schemes.push({ name, type: 'http-bearer' });
    } else if (def.type === 'http' && def.scheme === 'basic') {
      schemes.push({ name, type: 'http-basic' });
    } else if (def.type === 'basic') {
      // Swagger 2.0
      schemes.push({ name, type: 'http-basic' });
    } else if (def.type === 'apiKey') {
      schemes.push({ name, type: 'apiKey', in: def.in, headerName: def.name });
    } else {
      schemes.push({ name, type: 'unsupported', originalType: def.type });
    }
  }

  return schemes;
}
