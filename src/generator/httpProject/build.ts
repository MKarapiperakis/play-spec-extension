import { toSafeProjectName, jsString, toSlug, toCamelIdentifier, toEnvPrefix } from '../naming';
import { exampleFromSchema, isAssertableExample } from '../exampleValue';
import { extractSecuritySchemes, SecurityScheme } from '../security';
import { resolveBaseUrl } from '../baseUrl';
import { listOperations, Operation } from '../operations';
import { operationKey, dynamicParams, buildParamsByOperation, renderParamsFile } from '../paramsData';
import * as templates from './templates';

function slugifyTag(tag: string): string {
  return (
    String(tag)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'default'
  );
}

/**
 * Returns the JS expression (as source text) that resolves this operation's
 * URL at test-runtime. Operations with no path/query params keep a plain
 * literal string; operations that have them read from tests/data/params.ts
 * via buildUrl() instead, since real values (e.g. a database id) often don't
 * exist anywhere in the spec itself.
 *
 * The literal branch strips the path's leading "/" — Playwright's `request`
 * fixture resolves a request path against playwright.config.ts's baseURL
 * using standard URL-resolution rules, where a leading "/" means
 * "root-relative" and silently discards any path segment baseURL itself has
 * (e.g. "/api/v1"), turning "GET /users" against baseURL
 * "http://host/api/v1/" into a request for "http://host/users" — a 404 the
 * spec's own servers[0].url gave no indication of. buildUrl() does the same
 * stripping for the dynamic-param branch (see urlHelperFile()); baseURL is
 * meanwhile normalized to always end with exactly one trailing slash (see
 * playwrightConfig()) — both halves are required together.
 */
function urlExprFor(op: Operation): string {
  const params = dynamicParams(op);
  if (!params.length) return jsString(op.path.replace(/^\/+/, ''));
  const queryParamNames = op.parameters.filter((p) => p.in === 'query' && p.required).map((p) => p.name);
  return `buildUrl(${jsString(operationKey(op))}, ${jsString(op.path)}, ${JSON.stringify(queryParamNames)})`;
}

const DIRECT_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

interface AuthRegistryEntry {
  schemeName: string;
  scheme: SecurityScheme;
  envPrefix: string;
  functionName: string;
  fileSlug: string;
  fileContent: string;
}

/**
 * Resolves which auth-scheme function(s) a single operation needs, using only
 * the FIRST alternative in its `security` array (OpenAPI's `security` is a
 * list of alternative requirement objects — "any one of these satisfies auth" —
 * and each object can itself require multiple schemes simultaneously, which we
 * do honor by merging all of them together).
 */
function resolveOperationAuthFns(op: Operation, authRegistry: Map<string, AuthRegistryEntry>): AuthRegistryEntry[] {
  const requirements = op.security || [];
  if (!requirements.length) return [];
  const firstAlternative = requirements[0] || {};
  return Object.keys(firstAlternative)
    .map((name) => authRegistry.get(name))
    .filter((fn): fn is AuthRegistryEntry => Boolean(fn));
}

function renderOperationTest(op: Operation, authRegistry: Map<string, AuthRegistryEntry>): string {
  const urlExpr = urlExprFor(op);
  const title = `${op.method.toUpperCase()} ${op.path} — ${op.summary}`;
  const successCodes = op.successResponses.map((r) => r.status);

  const bestShapeResponse = op.successResponses.find(
    (r) => isAssertableExample(r.example) || (r.schema && isAssertableExample(exampleFromSchema(r.schema)))
  );
  const expectedShape = bestShapeResponse ? bestShapeResponse.example ?? exampleFromSchema(bestShapeResponse.schema) : null;

  const authFns = resolveOperationAuthFns(op, authRegistry);
  const requestOptions: string[] = [];
  if (authFns.length) {
    requestOptions.push(`headers: { ${authFns.map((fn) => `...${fn.functionName}()`).join(', ')} }`);
  }
  if (op.requestBodySchema) {
    const body = exampleFromSchema(op.requestBodySchema);
    requestOptions.push(`data: ${JSON.stringify(body, null, 2).split('\n').join('\n    ')}`);
  }

  const optionsBlock = requestOptions.length ? `, {\n    ${requestOptions.join(',\n    ')},\n  }` : '';
  const fetchOptions = [`method: ${jsString(op.method.toUpperCase())}`, ...requestOptions];
  const methodCall = DIRECT_METHODS.has(op.method)
    ? `request.${op.method}(${urlExpr}${optionsBlock})`
    : `request.fetch(${urlExpr}, {\n    ${fetchOptions.join(',\n    ')},\n  })`;

  const lines = [
    `test(${jsString(title)}, async ({ request }) => {`,
    `  const response = await ${methodCall};`,
    `  expect(${JSON.stringify(successCodes)}).toContain(response.status());`,
  ];

  if (isAssertableExample(expectedShape)) {
    lines.push(
      "  if (process.env.SKIP_RESPONSE_VALIDATION !== 'true') {",
      '    const body = await response.json().catch(() => null);',
      '    if (body !== null) {',
      `      expectResponseMatches(body, ${JSON.stringify(expectedShape, null, 2).split('\n').join('\n      ')});`,
      '    }',
      '  }'
    );
  }

  lines.push('});');
  return lines.join('\n');
}

function buildSpecFile(tag: string, operations: Operation[], authRegistry: Map<string, AuthRegistryEntry>): string {
  const usedSchemeNames = new Set<string>();
  for (const op of operations) {
    for (const fn of resolveOperationAuthFns(op, authRegistry)) usedSchemeNames.add(fn.schemeName);
  }
  const authImports = [...usedSchemeNames]
    .map((name) => authRegistry.get(name)!)
    .map((fn) => `import { ${fn.functionName} } from '../helpers/auth/${fn.fileSlug}';`);

  const usesDynamicParams = operations.some((op) => dynamicParams(op).length > 0);

  const header = [
    "import { test, expect } from '@playwright/test';",
    ...(usesDynamicParams ? ["import { buildUrl } from '../helpers/url';"] : []),
    ...authImports,
    "import { expectResponseMatches } from '../helpers/assertSchema';",
    '',
    `test.describe(${jsString(tag)}, () => {`,
    '',
  ];
  const body = operations.map((op) => renderOperationTest(op, authRegistry)).join('\n\n');
  const indented = body
    .split('\n')
    .map((l) => (l ? '  ' + l : l))
    .join('\n');
  const footer = ['', '});', ''];
  return [...header, indented, ...footer].join('\n');
}

// Builds one file per declared security scheme (keyed by the scheme's own name
// from the spec), keyed in the returned Map by that same name for lookup from
// `op.security` requirement objects, which reference schemes by name.
function buildAuthRegistry(api: any): Map<string, AuthRegistryEntry> {
  const registry = new Map<string, AuthRegistryEntry>();
  for (const scheme of extractSecuritySchemes(api)) {
    const envPrefix = toEnvPrefix(scheme.name);
    const functionName = `${toCamelIdentifier(scheme.name)}Headers`;
    const fileSlug = toSlug(scheme.name) || 'scheme';
    let fileContent: string;
    if (scheme.type === 'http-bearer') fileContent = templates.bearerAuthFile(scheme, envPrefix, functionName);
    else if (scheme.type === 'http-basic') fileContent = templates.basicAuthFile(scheme, envPrefix, functionName);
    else if (scheme.type === 'apiKey') fileContent = templates.apiKeyAuthFile(scheme, envPrefix, functionName);
    else continue; // unsupported scheme type (e.g. oauth2) — not generated

    registry.set(scheme.name, { schemeName: scheme.name, scheme, envPrefix, functionName, fileSlug, fileContent });
  }
  return registry;
}

export interface BuildOptions {
  projectName?: string;
  baseUrl?: string;
  skipResponseValidation?: boolean;
}

export interface BuiltProject {
  projectName: string;
  operationCount: number;
  tagCount: number;
  authSchemeCount: number;
  fileMap: Record<string, string>;
}

/**
 * Builds the file map for a "direct HTTP" Playwright project: tests call the
 * API over HTTP via Playwright's `request` fixture, driven purely by the
 * parsed OpenAPI document. Works for any spec, no hosted UI required.
 */
export function buildHttpProject(api: any, options: BuildOptions = {}): BuiltProject {
  const projectName = toSafeProjectName(options.projectName || (api.info && api.info.title) || 'openapi-http-tests');
  const baseUrl = resolveBaseUrl(api, options.baseUrl);
  const operations = listOperations(api);
  const authRegistry = buildAuthRegistry(api);

  const byTag = new Map<string, Operation[]>();
  for (const op of operations) {
    const tag = op.tags[0];
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag)!.push(op);
  }
  const tagSlugs = [...new Set([...byTag.keys()].map(slugifyTag))];

  const fileMap: Record<string, string> = {
    'package.json': templates.packageJson(projectName, tagSlugs),
    'playwright.config.ts': templates.playwrightConfig(baseUrl),
    '.env.sample': templates.envSample({
      authSchemes: [...authRegistry.values()],
      baseUrl,
      skipResponseValidation: Boolean(options.skipResponseValidation),
    }),
    'README.md': templates.readme(projectName, operations.length, tagSlugs),
    'tests/helpers/assertSchema.ts': templates.assertSchemaHelper(),
  };

  for (const { fileSlug, fileContent } of authRegistry.values()) {
    fileMap[`tests/helpers/auth/${fileSlug}.ts`] = fileContent;
  }

  const paramsByOperation = buildParamsByOperation(operations);
  if (Object.keys(paramsByOperation).length) {
    fileMap['tests/data/params.ts'] = renderParamsFile(paramsByOperation);
    fileMap['tests/helpers/url.ts'] = templates.urlHelperFile();
  }

  for (const [tag, ops] of byTag.entries()) {
    fileMap[`tests/spec/${slugifyTag(tag)}.spec.ts`] = buildSpecFile(tag, ops, authRegistry);
  }

  return {
    projectName,
    operationCount: operations.length,
    tagCount: byTag.size,
    authSchemeCount: authRegistry.size,
    fileMap,
  };
}
