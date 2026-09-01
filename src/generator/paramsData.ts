import { exampleFromSchema } from './exampleValue';
import { Operation } from './operations';

/** Stable key identifying an operation, used to look up its param values. */
export function operationKey(op: Operation): string {
  return `${op.method.toUpperCase()} ${op.path}`;
}

/**
 * Path params + required query params, in spec-declaration order — the set
 * of parameters that need a concrete value to actually call the operation,
 * and which may not have any real-world value present anywhere in the spec
 * (e.g. an id that only exists in the target environment's database).
 */
export function dynamicParams(op: Operation): any[] {
  return op.parameters.filter((p) => p.in === 'path' || (p.in === 'query' && p.required));
}

/** Builds the { "METHOD /path": { paramName: placeholderValue } } map for every operation that has dynamic params. */
export function buildParamsByOperation(operations: Operation[]): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const op of operations) {
    const params = dynamicParams(op);
    if (!params.length) continue;
    const values: Record<string, string> = {};
    for (const p of params) {
      values[p.name] = String(exampleFromSchema(p.schema || {}) ?? '');
    }
    result[operationKey(op)] = values;
  }
  return result;
}

export function renderParamsFile(paramsByOperation: Record<string, Record<string, string>>): string {
  return `/**
 * Dynamic path/query parameter values, keyed by "METHOD /path" (matching each
 * test's title in this project). Pre-filled with placeholder values derived
 * from the OpenAPI spec — edit these with real values for your environment,
 * e.g. IDs that only exist in your database and were never in the spec itself.
 */
export const testParams: Record<string, Record<string, string>> = ${JSON.stringify(paramsByOperation, null, 2)};
`;
}
