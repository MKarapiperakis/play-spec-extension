import * as vscode from 'vscode';
import { joinPath, fileExists, readTextFile, writeTextFile } from '../utils/fsHelpers';
import { findGeneratedTests } from '../utils/testDiscovery';

// Tree-node argument shape when invoked from the "Generated Tests" section —
// same as runGeneratedTestCommands.ts.
interface TestFileNodeLike {
  ref: {
    projectRootUri: vscode.Uri;
    relativePath: string;
    fileUri: vscode.Uri;
  };
}

/** ("tests/spec/pets/get-pets.spec.ts", 2) -> "tests/spec/pets/get-pets.custom2.spec.ts" */
function customPathFor(relativePath: string, n: number): string {
  return relativePath.replace(/\.spec\.ts$/, `.custom${n}.spec.ts`);
}

/**
 * Retitles the copied generated test so each custom one is distinguishable
 * from the original (and from each other) in Playwright's output and HTML
 * report. Generated titles are always written as a JSON string literal (see
 * jsString() in naming.ts).
 */
function retitle(content: string, n: number): string {
  return content.replace(/^(\s*)test\(("(?:[^"\\]|\\.)*"),/m, (_match, indent: string, literal: string) => {
    const title = JSON.parse(literal) as string;
    return `${indent}test(${JSON.stringify(`${title} — custom case ${n}`)},`;
  });
}

function sameFile(a: vscode.Uri, b: vscode.Uri): boolean {
  return process.platform === 'win32' ? a.fsPath.toLowerCase() === b.fsPath.toLowerCase() : a.fsPath === b.fsPath;
}

/**
 * Accepts every way this command can be invoked: a tree node (PlaySpec
 * explorer), a file Uri (VS Code Explorer / editor context menus), or nothing
 * (keybinding etc. — falls back to the active editor). A Uri is matched
 * against the PlaySpec manifests, since only a generated test is a valid base.
 */
async function resolveTarget(target?: TestFileNodeLike | vscode.Uri): Promise<TestFileNodeLike | undefined> {
  if (target && !(target instanceof vscode.Uri)) return target;

  const uri = target ?? vscode.window.activeTextEditor?.document.uri;
  if (!uri) {
    vscode.window.showWarningMessage('PlaySpec: open or select a generated test file to base a custom test on.');
    return undefined;
  }

  const ref = (await findGeneratedTests()).find((r) => !r.isCustom && sameFile(r.fileUri, uri));
  if (!ref) {
    vscode.window.showWarningMessage(
      `PlaySpec: ${vscode.workspace.asRelativePath(uri)} isn't a PlaySpec-generated test — custom tests can only be created from one.`
    );
    return undefined;
  }
  return { ref };
}

/**
 * Creates a new numbered custom test file next to a generated one
 * (<name>.custom1.spec.ts, then custom2, ... — first free number), seeded
 * with a copy of the generated test (imports, auth headers, URL building,
 * request call all already wired up) as a starting point to adapt for an
 * additional case. The `.customN.spec.ts` suffix can never collide with a
 * generated file name (those are slugs, which contain no dots), so
 * regeneration never touches it — see findGeneratedTests(), which lists it as
 * a custom test. An existing file is never overwritten.
 */
export async function addCustomTestCommand(target?: TestFileNodeLike | vscode.Uri): Promise<void> {
  const node = await resolveTarget(target);
  if (!node) return;

  const generated = await readTextFile(node.ref.fileUri);
  if (generated === undefined) {
    vscode.window.showErrorMessage(`PlaySpec: couldn't read ${node.ref.relativePath} to base a custom test on.`);
    return;
  }

  let n = 1;
  while (await fileExists(joinPath(node.ref.projectRootUri, customPathFor(node.ref.relativePath, n)))) n++;
  const customUri = joinPath(node.ref.projectRootUri, customPathFor(node.ref.relativePath, n));

  const header = [
    '// Custom test — your own file. PlaySpec never overwrites it on regeneration.',
    `// Seeded from ${node.ref.relativePath.split('/').pop()}; edit it or add more test() cases below.`,
    '',
  ].join('\n');
  await writeTextFile(customUri, header + retitle(generated, n));
  await vscode.window.showTextDocument(customUri);
}
