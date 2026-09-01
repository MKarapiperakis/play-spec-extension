import * as yaml from 'js-yaml';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SwaggerParser = require('@apidevtools/swagger-parser');

export class SpecError extends Error {}

export interface LoadedSpec {
  original: any;
  api: any;
}

/**
 * Parses raw spec text (YAML or JSON) and returns both the original
 * document and a fully $ref-dereferenced copy for easy traversal.
 */
export async function loadSpec(rawText: string): Promise<LoadedSpec> {
  let parsed: any;
  try {
    parsed = yaml.load(rawText);
  } catch (err: any) {
    throw new SpecError(`Could not parse file as YAML/JSON: ${err.message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new SpecError('Spec file is empty or not a valid OpenAPI/Swagger document.');
  }
  if (!parsed.openapi && !parsed.swagger) {
    throw new SpecError('Document does not look like an OpenAPI/Swagger spec (missing "openapi" or "swagger" field).');
  }

  let dereferenced: any;
  try {
    // Clone so SwaggerParser's in-place mutation doesn't affect `parsed`.
    dereferenced = await SwaggerParser.dereference(JSON.parse(JSON.stringify(parsed)), {
      // Untrusted input: a malicious spec could contain a $ref pointing at an
      // internal URL (SSRF) or a local file path (arbitrary file read). Only
      // resolve refs within the document itself ("#/components/..."); never
      // follow the document out to the network or the filesystem.
      resolve: { http: false, file: false },
    });
  } catch (err: any) {
    throw new SpecError(`Failed to resolve $ref references in spec: ${err.message}`);
  }

  return { original: parsed, api: dereferenced };
}
