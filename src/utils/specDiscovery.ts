import * as vscode from 'vscode';

const MAX_CANDIDATES = 500;

export interface SpecFileRef {
  uri: vscode.Uri;
  relativePath: string;
}

/** Cheap heuristic: does this look like the start of an OpenAPI/Swagger document? No full parse. */
function looksLikeOpenApiSpec(head: string): boolean {
  return /(^|[\s{,"'])(openapi|swagger)\s*["']?\s*[:=]/m.test(head);
}

/**
 * Scans the workspace for .json/.yaml/.yml files that look like OpenAPI/Swagger
 * specs (cheap prefix check, not a full parse/validate — just enough to filter
 * out package.json, tsconfig.json, etc.). Excludes common noisy directories and
 * the configured PlaySpec output folder itself.
 */
export async function findSpecFiles(): Promise<SpecFileRef[]> {
  if (!vscode.workspace.workspaceFolders?.length) return [];

  const outputFolder = vscode.workspace.getConfiguration('playspec').get<string>('outputFolderName', 'playwright-tests');
  const exclude = `**/{node_modules,.git,dist,out,build,coverage,${outputFolder}}/**`;

  const candidates = await vscode.workspace.findFiles('**/*.{json,yaml,yml}', exclude, MAX_CANDIDATES);

  const checks = await Promise.all(
    candidates.map(async (uri): Promise<SpecFileRef | undefined> => {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const head = Buffer.from(bytes.subarray(0, 4096)).toString('utf8');
        if (!looksLikeOpenApiSpec(head)) return undefined;
        return { uri, relativePath: vscode.workspace.asRelativePath(uri) };
      } catch {
        return undefined; // unreadable/binary — skip
      }
    })
  );

  return checks
    .filter((ref): ref is SpecFileRef => Boolean(ref))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
