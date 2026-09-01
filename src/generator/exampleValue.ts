/**
 * Best-effort generation of a plausible example value from a (dereferenced)
 * JSON Schema / OpenAPI schema object. Prefers explicit example/default/enum
 * values from the spec before falling back to type-based placeholders.
 */
export function exampleFromSchema(schema: any, seen: Set<any> = new Set()): any {
  if (!schema || typeof schema !== 'object') return null;

  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];

  // Cycle guard, checked once here (rather than per-branch) so it covers every
  // recursive path — allOf/oneOf/anyOf composition and array items included,
  // not just plain object properties. Dereferenced specs commonly produce
  // real circular object graphs (e.g. a "Category" or "TreeNode" schema that
  // references itself, directly or via allOf composition a few levels down),
  // and without this a schema reachable from itself through any of those
  // paths recurses without end. Placed after the literal example/default/enum
  // checks above so a legitimately-reused (non-circular) $ref with its own
  // example still always returns that example in full.
  if (seen.has(schema)) return {};
  seen.add(schema);

  if (Array.isArray(schema.allOf) && schema.allOf.length) {
    return schema.allOf.reduce((acc: any, sub: any) => Object.assign(acc, exampleFromSchema(sub, seen) || {}), {});
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length) return exampleFromSchema(schema.oneOf[0], seen);
  if (Array.isArray(schema.anyOf) && schema.anyOf.length) return exampleFromSchema(schema.anyOf[0], seen);

  const type = schema.type || (schema.properties ? 'object' : undefined);

  switch (type) {
    case 'object': {
      const obj: Record<string, any> = {};
      const props = schema.properties || {};
      for (const key of Object.keys(props)) {
        obj[key] = exampleFromSchema(props[key], seen);
      }
      return obj;
    }
    case 'array': {
      const item = exampleFromSchema(schema.items || {}, seen);
      return [item];
    }
    case 'string':
      if (schema.format === 'date-time') return new Date().toISOString();
      if (schema.format === 'date') return new Date().toISOString().slice(0, 10);
      if (schema.format === 'email') return 'user@example.com';
      if (schema.format === 'uuid') return '00000000-0000-4000-8000-000000000000';
      return 'string';
    case 'integer':
      return schema.minimum ?? 1;
    case 'number':
      return schema.minimum ?? 1;
    case 'boolean':
      return true;
    default:
      return null;
  }
}

/** Returns the top-level keys of an object-shaped example/schema, for shape assertions. */
export function shapeKeys(example: any): string[] | null {
  if (!example || typeof example !== 'object' || Array.isArray(example)) return null;
  return Object.keys(example);
}

/**
 * True for anything worth generating a response-shape assertion against —
 * a non-null object OR an array (unlike `shapeKeys`, which only recognizes
 * plain objects and would otherwise cause array-typed response schemas,
 * e.g. `schema: { type: array, items: {...} }`, to be silently skipped).
 */
export function isAssertableExample(value: any): boolean {
  return value !== null && value !== undefined && typeof value === 'object';
}
