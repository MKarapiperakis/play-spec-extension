import { HTTP_METHODS, HttpMethod } from './naming';

export interface SuccessResponse {
  status: number;
  schema: any;
  example: any;
}

export interface Operation {
  path: string;
  method: HttpMethod;
  operationId?: string;
  rawSummary?: string;
  summary: string;
  tags: string[];
  parameters: any[];
  requestBodySchema: any;
  successResponses: SuccessResponse[];
  security: any[];
}

/**
 * Flattens api.paths into a list of operations:
 *   { path, method, summary, tags, parameters, requestBodySchema, successResponses }
 * where parameters is the merged path-item + operation level parameter list,
 * and successResponses is [{ status, schema, example }] for 2xx JSON responses.
 */
export function listOperations(api: any): Operation[] {
  const operations: Operation[] = [];
  const paths = api.paths || {};

  for (const [pathKey, pathItem] of Object.entries<any>(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    const pathLevelParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      const parameters = [...pathLevelParams, ...(operation.parameters || [])];

      let requestBodySchema = null;
      const rb = operation.requestBody;
      if (rb && rb.content && rb.content['application/json'] && rb.content['application/json'].schema) {
        requestBodySchema = rb.content['application/json'].schema;
      }

      const successResponses: SuccessResponse[] = [];
      for (const [status, response] of Object.entries<any>(operation.responses || {})) {
        if (!/^2\d\d$/.test(status)) continue;
        const jsonContent = response && response.content && response.content['application/json'];
        successResponses.push({
          status: Number(status),
          schema: jsonContent ? jsonContent.schema : null,
          example: jsonContent ? jsonContent.example : undefined,
        });
      }
      // Fall back to 200 if the spec documents no explicit success response.
      if (successResponses.length === 0) successResponses.push({ status: 200, schema: null, example: undefined });

      operations.push({
        path: pathKey,
        method,
        operationId: operation.operationId,
        rawSummary: operation.summary,
        summary: operation.summary || operation.description || `${method.toUpperCase()} ${pathKey}`,
        tags: operation.tags && operation.tags.length ? operation.tags : ['default'],
        parameters,
        requestBodySchema,
        successResponses,
        security: operation.security || api.security || [],
      });
    }
  }

  return operations;
}
