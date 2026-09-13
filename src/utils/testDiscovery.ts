import * as vscode from 'vscode';
import { readTextFile, joinPath } from './fsHelpers';
import { MANIFEST_RELATIVE_PATH } from './projectWriter';

export interface GeneratedTestRef {
  workspaceFolder: vscode.WorkspaceFolder;
  /** Root of the generated Playwright project, e.g. <workspace>/playwright-tests. */
  projectRootUri: vscode.Uri;
  /** Display label for the project root — workspace-folder-prefixed only in multi-root workspaces. */
  projectLabel: string;
  /** Folder under tests/spec/ this test was grouped into (its tag slug). */
  tag: string;
  /** "METHOD /path" — matches the test's own title, see operationKey() in paramsData.ts. */
  operationKey: string;
  /** Relative to projectRootUri, e.g. "tests/spec/pets/get-pets-id.spec.ts". */
  relativePath: string;
  fileUri: vscode.Uri;
}

function tagFromRelativePath(relativePath: string): string {
  const parts = relativePath.split('/');
  return parts.length >= 4 && parts[0] === 'tests' && parts[1] === 'spec' ? parts[2] : 'other';
}

/**
 * Reads every workspace folder's PlaySpec manifest (if generation has been
 * run there) to list the tests currently on disk — no re-parsing of the
 * generated .spec.ts files themselves, the manifest already has exactly what's
 * needed (operationKey -> file) as bookkeeping for safe regeneration.
 */
export async function findGeneratedTests(): Promise<GeneratedTestRef[]> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return [];

  const results: GeneratedTestRef[] = [];
  for (const folder of folders) {
    const outputFolderName = vscode.workspace.getConfiguration('playspec', folder).get<string>('outputFolderName', 'playwright-tests');
    const projectRootUri = vscode.Uri.joinPath(folder.uri, outputFolderName);
    const manifestText = await readTextFile(joinPath(projectRootUri, MANIFEST_RELATIVE_PATH));
    if (!manifestText) continue;

    let manifest: any;
    try {
      manifest = JSON.parse(manifestText);
    } catch {
      continue; // corrupt/hand-edited manifest — nothing reliable to list for this folder
    }
    if (!manifest || typeof manifest.operations !== 'object') continue;

    const projectLabel = vscode.workspace.asRelativePath(projectRootUri, folders.length > 1);

    for (const [operationKey, entry] of Object.entries<any>(manifest.operations)) {
      if (!entry || typeof entry.file !== 'string') continue;
      results.push({
        workspaceFolder: folder,
        projectRootUri,
        projectLabel,
        tag: tagFromRelativePath(entry.file),
        operationKey,
        relativePath: entry.file,
        fileUri: joinPath(projectRootUri, entry.file),
      });
    }
  }
  return results;
}
