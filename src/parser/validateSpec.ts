import * as yaml from 'js-yaml';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SwaggerParser = require('@apidevtools/swagger-parser');
import { listOperations, Operation } from '../generator/operations';
import { extractSecuritySchemes, SecurityScheme } from '../generator/security';
import { isAssertableExample, exampleFromSchema } from '../generator/exampleValue';

const ERROR_WEIGHT = 30;
const WARNING_WEIGHT = 10;

// The same set of methods the HTTP generator actually turns into tests
// (src/generator/httpProject/build.ts's SUPPORTED_METHODS) — options/head
// operations, though listOperations() picks them up too, are left out of the
// endpoint listing since they're never generated.
const ENDPOINT_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const PATH_PARAM_PATTERN = /\{([^}]+)\}/g;

// Schemas past this nesting depth are truncated in the summary — defends
// against a pathologically deep (or adversarially crafted) spec blowing up
// the report size, same spirit as the SSRF/file-read guards on $ref
// resolution in loadSpec.ts.
const MAX_SCHEMA_DEPTH = 12;

export type Severity = 'error' | 'warning';

export interface Issue {
  severity: Severity;
  message: string;
  path: string | null;
}

export interface Category {
  id: string;
  label: string;
  status: 'pass' | 'warning' | 'error';
  issues: Issue[];
}

export interface ValidationSummary {
  title: string | null;
  specVersion: string | null;
  pathCount: number;
  operationCount: number;
  hasBaseUrl: boolean;
  securitySchemes: { name: string; type: string }[];
  endpoints: Record<string, { path: string; summary: string | null }[]>;
  tags: { name: string; description: string | null }[];
  schemas: { name: string; definition: any }[];
}

export interface ValidationResult {
  valid: boolean;
  canGenerate: boolean;
  severity: 'good' | 'medium' | 'bad';
  score: number;
  errors: { message: string; path: string | null }[];
  warnings: { message: string; path: string | null }[];
  categories: Category[] | null;
  summary: ValidationSummary | null;
}

// SwaggerParser.dereference() resolves $refs by pointing multiple places at
// the *same* object instance rather than deep-copying — required to support
// genuinely circular schemas (e.g. a `Node` schema nesting itself), but that
// means a naive JSON.stringify on it can throw "Converting circular
// structure to JSON". This walks each schema tracking only the current
// recursion path (not every object seen globally, since legitimate specs
// commonly reuse the exact same subschema instance in unrelated sibling
// branches — that's reuse, not a cycle) and swaps a true cycle for a marker
// string instead of recursing into it forever.
function decycleSchema(value: any, seen: Set<any> = new Set(), depth = 0): any {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular reference]';
  if (depth >= MAX_SCHEMA_DEPTH) return Array.isArray(value) ? ['…'] : { '…': 'truncated (too deeply nested)' };

  seen.add(value);
  const result = Array.isArray(value)
    ? value.map((v) => decycleSchema(v, seen, depth + 1))
    : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decycleSchema(v, seen, depth + 1)]));
  seen.delete(value);
  return result;
}

function scoreFor(errors: Issue[], warnings: Issue[]): number {
  return Math.max(0, 100 - errors.length * ERROR_WEIGHT - warnings.length * WARNING_WEIGHT);
}

function severityFor(errors: any[], warnings: any[]): 'good' | 'medium' | 'bad' {
  if (errors.length) return 'bad';
  if (warnings.length) return 'medium';
  return 'good';
}

function categoryStatus(issues: Issue[]): 'pass' | 'warning' | 'error' {
  if (issues.some((i) => i.severity === 'error')) return 'error';
  if (issues.some((i) => i.severity === 'warning')) return 'warning';
  return 'pass';
}

function category(id: string, label: string, issues: Issue[]): Category {
  return { id, label, status: categoryStatus(issues), issues };
}

function summarize(
  errors: { message: string; path: string | null }[],
  warnings: { message: string; path: string | null }[],
  extra?: { canGenerate?: boolean; categories?: Category[]; summary?: ValidationSummary }
): ValidationResult {
  return {
    valid: errors.length === 0,
    canGenerate: !!(extra && extra.canGenerate),
    severity: severityFor(errors, warnings),
    score: scoreFor(errors as Issue[], warnings as Issue[]),
    errors,
    warnings,
    categories: (extra && extra.categories) || null,
    summary: (extra && extra.summary) || null,
  };
}

function decodePointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

// ajv's instancePath is a JSON Pointer (RFC 6901): segments are
// "/"-separated, and a "/" or "~" that's part of a segment's own text (e.g.
// a path key like "/api/v1/orders" used as an object key) is escaped inside
// that segment as ~1 / ~0 rather than treated as a separator — so it's safe
// to split on "/" first and only then decode each piece.
function splitPointer(pointer: string): string[] {
  return pointer
    .split('/')
    .filter((s) => s.length > 0)
    .map(decodePointerSegment);
}

// Best-effort translation of an ajv instancePath into something a spec
// author can actually place, e.g. "/paths/~1api~1v1~1orders/get/parameters/5/in"
// becomes `GET /api/v1/orders — parameter "id", field "in"`. Looks the
// parameter up in the raw (pre-validation) document to recover its `name`
// even though the parameter itself is the thing failing validation — the
// rest of it (like `name`) is usually still intact. Falls back to a
// slash-free rendering of the decoded segments for shapes this doesn't
// recognize, so an unfamiliar error location still reads better than the
// raw pointer instead of throwing.
function humanizePointer(pointer: string | null, doc: any): string | null {
  if (!pointer) return null;
  const segments = splitPointer(pointer);
  if (segments.length === 0) return null;

  if (segments[0] === 'paths' && segments.length >= 3) {
    const pathKey = segments[1];
    const method = segments[2];
    let label = `${method.toUpperCase()} ${pathKey}`;

    if (segments[3] === 'parameters' && segments.length >= 5) {
      const index = Number(segments[4]);
      const param = doc?.paths?.[pathKey]?.[method]?.parameters?.[index];
      const name = param && typeof param.name === 'string' ? `"${param.name}"` : `#${index + 1}`;
      label += ` — parameter ${name}`;
      if (segments.length > 5) label += `, field "${segments.slice(5).join('.')}"`;
      return label;
    }

    if (segments.length > 3) label += ` — ${segments.slice(3).join('.')}`;
    return label;
  }

  return segments.join(' › ');
}

function resolvePointerValue(doc: any, pointer: string): any {
  let cur = doc;
  for (const segment of splitPointer(pointer)) {
    if (cur == null) return undefined;
    cur = cur[segment];
  }
  return cur;
}

// The OpenAPI/Swagger meta-schema defines things like "a parameter" as a
// `oneOf` between a real Parameter object and a `{ $ref: ... }` reference —
// so a single typo'd parameter produces a whole cluster of ajv errors: one
// generic "must match exactly one schema in oneOf" plus a full set of
// required/additionalProperties errors *for each branch it failed*,
// including the $ref branch that was never actually being attempted. Left
// alone, one mistake reads as 6-8 unrelated-looking errors. This drops:
//  - bare oneOf "didn't match any branch" errors, which never carry
//    information beyond the branch-specific errors already sitting next to
//    them, and
//  - "missing required property '$ref'" errors where the object in question
//    doesn't have a $ref key at all, i.e. it was never trying to be a
//    reference in the first place.
function isBranchNoise(d: any, doc: any): boolean {
  if (d.keyword === 'oneOf' || d.keyword === 'anyOf') return true;
  if (d.keyword === 'required' && d.params?.missingProperty === '$ref') {
    const target = resolvePointerValue(doc, d.instancePath || '');
    return !(target && typeof target === 'object' && '$ref' in target);
  }
  return false;
}

// Turns an ajv-style validation failure (SwaggerParser.validate rejects with
// an array-like error whose `.details` holds one entry per schema violation)
// into our flat { message, path } shape; falls back to a single entry for
// anything else SwaggerParser can throw (dangling $ref, malformed document,
// etc.). `doc` is the raw pre-validation document, used to resolve a
// human-readable location for each error (see humanizePointer) and to
// filter out oneOf/$ref branch noise (see isBranchNoise).
function normalizeValidationError(err: any, doc: any): { message: string; path: string | null }[] {
  if (Array.isArray(err.details) && err.details.length) {
    const details = err.details.filter((d: any) => !isBranchNoise(d, doc));
    const usable = details.length ? details : err.details;
    return usable.map((d: any) => {
      const location = humanizePointer(d.instancePath || null, doc);

      const extras: string[] = [];
      if (d.params) {
        if (Array.isArray(d.params.allowedValues)) extras.push(`allowed: ${d.params.allowedValues.join(', ')}`);
        if (d.params.missingProperty) extras.push(`missing property: "${d.params.missingProperty}"`);
        if (d.params.additionalProperty) extras.push(`unexpected property: "${d.params.additionalProperty}"`);
      }
      const suffix = extras.length ? ` (${extras.join('; ')})` : '';

      const message = d.message ? `${d.message}${suffix}` : String(d);
      return {
        message: location ? `${location} — ${message}` : message,
        path: d.instancePath || null,
      };
    });
  }
  return [{ message: err.message, path: null }];
}

function buildEndpointsByMethod(operations: Operation[]): Record<string, { path: string; summary: string | null }[]> {
  const endpoints: Record<string, { path: string; summary: string | null }[]> = {};
  for (const method of ENDPOINT_METHODS) {
    const ops = operations.filter((op) => op.method === method);
    if (ops.length) endpoints[method] = ops.map((op) => ({ path: op.path, summary: op.rawSummary || null }));
  }
  return endpoints;
}

function buildSummary(api: any, operations: Operation[], securitySchemes: SecurityScheme[]): ValidationSummary {
  const hasServers = Array.isArray(api.servers) && api.servers.length > 0;
  const hasSwagger2Host = typeof api.host === 'string' && api.host.length > 0;

  // OpenAPI 3 keeps these under components.schemas; Swagger 2 (still
  // supported for validation, not generation) calls the same thing
  // "definitions" at the document root.
  const schemasSource = (api.components && api.components.schemas) || api.definitions || {};

  return {
    title: (api.info && api.info.title) || null,
    specVersion: api.openapi || api.swagger || null,
    pathCount: new Set(operations.map((op) => op.path)).size,
    operationCount: operations.length,
    hasBaseUrl: hasServers || hasSwagger2Host,
    securitySchemes: securitySchemes.map((s) => ({ name: s.name, type: s.type })),
    endpoints: buildEndpointsByMethod(operations),
    tags: (api.tags || []).map((t: any) => ({ name: t.name, description: t.description || null })),
    schemas: Object.entries(schemasSource).map(([name, schema]) => ({ name, definition: decycleSchema(schema) })),
  };
}

// "Schema structure": the spec's overall structural validity — OpenAPI/JSON
// Schema violations from SwaggerParser.validate() (passed in as
// `schemaErrors`, already collected before this runs) plus whether there's
// anything at all to generate from.
function checkSchemaStructure(operations: Operation[], schemaErrors: { message: string; path: string | null }[]): Category {
  const issues: Issue[] = schemaErrors.map((e) => ({ severity: 'error', message: e.message, path: e.path }));
  if (operations.length === 0) {
    issues.push({
      severity: 'error',
      message: 'Spec has no GET/POST/PUT/PATCH/DELETE operations — there is nothing to generate tests for.',
      path: '/paths',
    });
  }
  return category('schema-structure', 'Schema structure', issues);
}

// "Security definitions": scheme types the generator can't produce auth for,
// and — the more actionable case — an operation's `security` requirement
// naming a scheme that was never declared under components.securitySchemes
// at all. Neither blocks generation (build.ts's resolveOperationAuthFns just
// silently drops auth it can't resolve), so both are warnings, not errors —
// but a dangling reference in particular is almost always a typo worth
// surfacing.
function checkSecurityDefinitions(operations: Operation[], securitySchemes: SecurityScheme[]): Category {
  const issues: Issue[] = [];
  const declaredNames = new Set(securitySchemes.map((s) => s.name));

  for (const scheme of securitySchemes.filter((s) => s.type === 'unsupported')) {
    issues.push({
      severity: 'warning',
      message: `Security scheme "${scheme.name}" (type "${scheme.originalType}") is not supported by the generator — requests using it will go out unauthenticated.`,
      path: '/components/securitySchemes',
    });
  }

  const flaggedDangling = new Set<string>();
  for (const op of operations) {
    for (const requirement of op.security || []) {
      for (const name of Object.keys(requirement)) {
        if (declaredNames.has(name) || flaggedDangling.has(name)) continue;
        flaggedDangling.add(name);
        issues.push({
          severity: 'warning',
          message: `Security scheme "${name}" is referenced by ${op.method.toUpperCase()} ${op.path} but isn't declared in components.securitySchemes — those requests will be generated without auth.`,
          path: '/components/securitySchemes',
        });
      }
    }
  }

  return category('security-definitions', 'Security definitions', issues);
}

// "Missing response examples": operations whose success response has no
// example/schema the generator can build a shape assertion from (mirrors
// isAssertableExample, the same check build.ts uses to decide whether to
// assert response body shape at all) — the resulting test still runs, it
// just only checks the HTTP status code.
function checkResponseExamples(operations: Operation[]): Category {
  const issues: Issue[] = [];
  for (const op of operations) {
    const hasAssertable = op.successResponses.some(
      (r) => isAssertableExample(r.example) || (r.schema && isAssertableExample(exampleFromSchema(r.schema)))
    );
    if (!hasAssertable) {
      issues.push({
        severity: 'warning',
        message: `${op.method.toUpperCase()} ${op.path} has no response example or schema — its generated test will only assert the HTTP status code.`,
        path: `/paths/${op.path}/${op.method}/responses`,
      });
    }
  }
  return category('response-examples', 'Missing response examples', issues);
}

// "Undeclared path parameters": a `{name}` placeholder in the path template
// that isn't declared as an `in: path` parameter anywhere. This blocks
// generation (it's the one category that can produce a genuinely broken
// test): build.ts's urlExprFor only calls the generated buildUrl() helper
// when the operation has *some* declared dynamic param — if the undeclared
// one is the operation's only path param, the literal, unsubstituted path
// template (e.g. "/pets/{id}") gets used as the URL outright; otherwise
// buildUrl() throws "Missing value" at test-runtime. Either way the test can
// never pass, so this is an error, not a warning.
function checkPathParameters(operations: Operation[]): Category {
  const issues: Issue[] = [];
  for (const op of operations) {
    const declared = new Set(op.parameters.filter((p) => p.in === 'path').map((p) => p.name));
    const usedNames = [...op.path.matchAll(PATH_PARAM_PATTERN)].map((m) => m[1]);
    for (const name of new Set(usedNames)) {
      if (!declared.has(name)) {
        issues.push({
          severity: 'error',
          message: `${op.path} — path parameter "${name}" is used but not declared in the parameters list.`,
          path: `/paths/${op.path}/${op.method}/parameters`,
        });
      }
    }
  }
  return category('path-parameters', 'Undeclared path parameters', issues);
}

// "Generation readiness": lower-stakes checks that affect output quality
// rather than correctness — no base URL to call, operations with no
// `summary` (cosmetic only for the HTTP generator), and operation tags that
// don't match the spec's own top-level "tags" catalog. That last one isn't
// purely cosmetic — build.ts groups generated tests (and their per-tag npm
// scripts) by op.tags[0], so a typo'd tag still "works", it just silently
// produces its own undocumented group instead of joining the one the author
// presumably meant.
function checkReadiness(api: any, operations: Operation[]): Category {
  const issues: Issue[] = [];
  const hasServers = Array.isArray(api.servers) && api.servers.length > 0;
  const hasSwagger2Host = typeof api.host === 'string' && api.host.length > 0;
  if (!hasServers && !hasSwagger2Host) {
    issues.push({
      severity: 'warning',
      message: 'Spec declares no base URL ("servers" / "host") — requests will target an empty base unless one is set some other way.',
      path: '/servers',
    });
  }

  const withoutSummary = operations.filter((op) => !op.rawSummary);
  if (withoutSummary.length) {
    issues.push({
      severity: 'warning',
      message: `${withoutSummary.length} operation(s) have no "summary" field.`,
      path: '/paths',
    });
  }

  // Only check against the catalog if the spec actually declares one — most
  // specs never bother with a top-level "tags" list at all, and flagging
  // every operation tag as "undeclared" in that case would be pure noise.
  const declaredTags = Array.isArray(api.tags) ? new Set<string>(api.tags.map((t: any) => t.name)) : null;
  if (declaredTags && declaredTags.size > 0) {
    const flagged = new Set<string>();
    for (const op of operations) {
      for (const tag of op.tags) {
        // listOperations() stamps this in for operations with no tags of
        // their own — not something from the spec, never flag it.
        if (tag === 'default' || declaredTags.has(tag) || flagged.has(tag)) continue;
        flagged.add(tag);
        issues.push({
          severity: 'warning',
          message: `Tag "${tag}" (used by ${op.method.toUpperCase()} ${op.path}) isn't declared in the spec's top-level "tags" list — likely a typo. It'll still work and get its own group in the generated project, just without a description anywhere.`,
          path: '/tags',
        });
      }
    }
  }

  return category('generation-readiness', 'Generation readiness', issues);
}

function buildCategories(
  api: any,
  operations: Operation[],
  securitySchemes: SecurityScheme[],
  schemaErrors: { message: string; path: string | null }[]
): Category[] {
  return [
    checkSchemaStructure(operations, schemaErrors),
    checkSecurityDefinitions(operations, securitySchemes),
    checkResponseExamples(operations),
    checkPathParameters(operations),
    checkReadiness(api, operations),
  ];
}

/**
 * Parses and validates raw spec text (YAML or JSON) without generating a
 * project, so callers can check whether test generation would succeed and
 * why before committing to it. Never throws — every failure mode is
 * reported in the returned result.
 */
export async function validateSpecText(rawText: string): Promise<ValidationResult> {
  let parsed: any;
  try {
    parsed = yaml.load(rawText);
  } catch (err: any) {
    return summarize([{ message: `Could not parse file as YAML/JSON: ${err.message}`, path: null }], []);
  }

  if (!parsed || typeof parsed !== 'object') {
    return summarize([{ message: 'Spec file is empty or not a valid OpenAPI/Swagger document.', path: null }], []);
  }
  if (!parsed.openapi && !parsed.swagger) {
    return summarize(
      [{ message: 'Document does not look like an OpenAPI/Swagger spec (missing "openapi" or "swagger" field).', path: null }],
      []
    );
  }

  // Untrusted input: never let $ref resolution reach the network or local
  // filesystem (SSRF / arbitrary file read) — same restriction as loadSpec.ts.
  const resolveOptions = { resolve: { http: false, file: false } };

  let api: any;
  let schemaErrors: { message: string; path: string | null }[] = [];
  try {
    api = await SwaggerParser.validate(JSON.parse(JSON.stringify(parsed)), resolveOptions);
  } catch (err: any) {
    schemaErrors = normalizeValidationError(err, parsed);
    // Still try a plain (non-validating) dereference so we can report
    // generator-readiness info even when the spec fails strict schema
    // validation — a spec can be usable for generation despite minor schema
    // nits (e.g. a missing "description").
    try {
      api = await SwaggerParser.dereference(JSON.parse(JSON.stringify(parsed)), resolveOptions);
    } catch {
      return summarize(schemaErrors, []);
    }
  }

  const operations = listOperations(api);
  const securitySchemes = extractSecuritySchemes(api);
  const categories = buildCategories(api, operations, securitySchemes, schemaErrors);

  const errors = categories.flatMap((c) => c.issues.filter((i) => i.severity === 'error').map((i) => ({ message: i.message, path: i.path })));
  const warnings = categories.flatMap((c) => c.issues.filter((i) => i.severity === 'warning').map((i) => ({ message: i.message, path: i.path })));

  return summarize(errors, warnings, {
    canGenerate: errors.length === 0,
    categories,
    summary: buildSummary(api, operations, securitySchemes),
  });
}
