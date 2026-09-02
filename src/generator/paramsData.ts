import { exampleFromSchema, explicitValueFromSchema } from './exampleValue';
import { Operation } from './operations';

/** Stable key identifying an operation, used to look up its param values. */
export function operationKey(op: Operation): string {
  return `${op.method.toUpperCase()} ${op.path}`;
}

/**
 * Path params (always required) + every query param, required or not, in
 * spec-declaration order — the full set of parameters exposed in
 * tests/data/params.ts for editing. Path params may not have any
 * real-world value present anywhere in the spec (e.g. an id that only
 * exists in the target environment's database); optional query params are
 * included too so they're visible and editable, even though a request is
 * still valid without them.
 */
export function dynamicParams(op: Operation): any[] {
  return op.parameters.filter((p) => p.in === 'path' || p.in === 'query');
}

/**
 * Placeholder value for one parameter: an explicit spec-declared value wins;
 * otherwise a path param (or a required query param) — which must have
 * *some* value for the request to be valid at all — falls back to a
 * type-based guess; an optional query param with nothing explicit declared
 * is left blank instead of guessing, since blank means "omit this from the
 * request" (see buildUrl() in url.ts) — the same outcome as not including
 * it, just visible and ready to fill in.
 */
function placeholderValue(p: any): string {
  const explicit = explicitValueFromSchema(p.schema || {});
  if (explicit !== undefined) return String(explicit);
  if (p.in === 'path' || p.required) return String(exampleFromSchema(p.schema || {}) ?? '');
  return '';
}

/** Builds the { "METHOD /path": { paramName: placeholderValue } } map for every operation that has dynamic params. */
export function buildParamsByOperation(operations: Operation[]): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const op of operations) {
    const params = dynamicParams(op);
    if (!params.length) continue;
    const values: Record<string, string> = {};
    for (const p of params) {
      values[p.name] = placeholderValue(p);
    }
    result[operationKey(op)] = values;
  }
  return result;
}

export function renderParamsFile(paramsByOperation: Record<string, Record<string, string>>): string {
  return `/**
 * Path/query parameter values, keyed by "METHOD /path" (matching each test's
 * title in this project). Path params and required query params are
 * pre-filled with placeholder values derived from the OpenAPI spec — edit
 * these with real values for your environment, e.g. IDs that only exist in
 * your database and were never in the spec itself.
 *
 * Optional query params are listed too, left blank ("") unless the spec
 * declared an explicit example/default — a blank value means that param is
 * left out of the request entirely; fill one in to have it sent.
 */
export const testParams: Record<string, Record<string, string>> = ${JSON.stringify(paramsByOperation, null, 2)};
`;
}
