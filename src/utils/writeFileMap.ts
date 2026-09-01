import * as vscode from 'vscode';

/**
 * Writes a flat { "relative/path": content } map under `rootUri`, creating
 * intermediate directories as needed. Returns the list of relative paths written.
 */
export async function writeFileMap(rootUri: vscode.Uri, fileMap: Record<string, string>): Promise<string[]> {
  const encoder = new TextEncoder();
  const written: string[] = [];
  for (const [relativePath, content] of Object.entries(fileMap)) {
    const fileUri = vscode.Uri.joinPath(rootUri, ...relativePath.split('/'));
    await vscode.workspace.fs.writeFile(fileUri, encoder.encode(content));
    written.push(relativePath);
  }
  return written;
}

/** Checks whether a directory exists and is non-empty (returns false for "doesn't exist" too). */
export async function directoryHasEntries(uri: vscode.Uri): Promise<boolean> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(uri);
    return entries.length > 0;
  } catch {
    return false;
  }
}
