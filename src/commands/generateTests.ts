import * as vscode from 'vscode';
import { loadSpec, SpecError } from '../parser/loadSpec';
import { buildHttpProject } from '../generator/httpProject/build';
import { fetchText, FetchError } from '../utils/fetchText';
import { writeFileMap, directoryHasEntries } from '../utils/writeFileMap';

const SPEC_FILE_FILTERS = { 'OpenAPI/Swagger spec': ['json', 'yaml', 'yml'] };

async function pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage('PlaySpec: open a folder or workspace first — generated tests are written into it.');
    return undefined;
  }
  if (folders.length === 1) return folders[0];
  return vscode.window.showWorkspaceFolderPick({ placeHolder: 'Select the workspace folder to generate tests into' });
}

async function readSpecFromFileUri(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString('utf8');
}

async function resolveOutputFolder(workspaceFolder: vscode.WorkspaceFolder): Promise<vscode.Uri | undefined> {
  const configuredName = vscode.workspace.getConfiguration('playspec').get<string>('outputFolderName', 'playwright-tests');
  const outputUri = vscode.Uri.joinPath(workspaceFolder.uri, configuredName);

  if (await directoryHasEntries(outputUri)) {
    const choice = await vscode.window.showWarningMessage(
      `"${configuredName}" already exists in ${workspaceFolder.name} and is not empty. Regenerating will overwrite files PlaySpec generates (like tests/spec/*.spec.ts) but leave other files untouched.`,
      { modal: true },
      'Overwrite',
      'Cancel'
    );
    if (choice !== 'Overwrite') return undefined;
  }

  return outputUri;
}

interface GenerationResult {
  outputUri: vscode.Uri;
  operationCount: number;
  tagCount: number;
}

async function runGeneration(specText: string, sourceLabel: string): Promise<void> {
  const workspaceFolder = await pickWorkspaceFolder();
  if (!workspaceFolder) return;

  // Only the parse/build/write work runs inside withProgress — its spinner
  // stays on screen until this whole callback resolves, so anything that
  // waits on user interaction (like the completion message's buttons below)
  // must happen *after* this returns, or the progress notification would
  // sit there indefinitely looking hung while it's actually just waiting
  // on a toast the user has no reason to expect yet.
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'PlaySpec: generating Playwright tests', cancellable: false },
    async (progress): Promise<GenerationResult | undefined> => {
      progress.report({ message: `Parsing ${sourceLabel}...` });

      let api: any;
      try {
        ({ api } = await loadSpec(specText));
      } catch (err) {
        if (err instanceof SpecError) {
          vscode.window.showErrorMessage(`PlaySpec: ${err.message}`);
          return undefined;
        }
        throw err;
      }

      progress.report({ message: 'Resolving output folder...' });
      const outputUri = await resolveOutputFolder(workspaceFolder);
      if (!outputUri) return undefined;

      const skipResponseValidation = vscode.workspace.getConfiguration('playspec').get<boolean>('skipResponseValidation', false);

      progress.report({ message: 'Generating test files...' });
      let built;
      try {
        built = buildHttpProject(api, { skipResponseValidation });
      } catch (err: any) {
        vscode.window.showErrorMessage(`PlaySpec: failed to generate tests from this spec: ${err.message || err}`);
        return undefined;
      }

      if (built.operationCount === 0) {
        vscode.window.showWarningMessage('PlaySpec: no operations were found in this spec — nothing to generate.');
        return undefined;
      }

      progress.report({ message: 'Writing files...' });
      await writeFileMap(outputUri, built.fileMap);

      return { outputUri, operationCount: built.operationCount, tagCount: built.tagCount };
    }
  );

  if (!result) return;

  const showFolderPrefix = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
  const relativeFolder = vscode.workspace.asRelativePath(result.outputUri, showFolderPrefix);
  const openReadme = 'Open README';
  const reveal = 'Reveal in Explorer';
  const choice = await vscode.window.showInformationMessage(
    `PlaySpec: generated ${result.operationCount} test(s) across ${result.tagCount} tag(s) in ${relativeFolder}.`,
    openReadme,
    reveal
  );

  if (choice === openReadme) {
    const readmeUri = vscode.Uri.joinPath(result.outputUri, 'README.md');
    const doc = await vscode.workspace.openTextDocument(readmeUri);
    await vscode.window.showTextDocument(doc, { preview: false });
  } else if (choice === reveal) {
    await vscode.commands.executeCommand('revealInExplorer', result.outputUri);
  }
}

export async function generateFromFileCommand(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: 'Generate Tests from This Spec',
    filters: SPEC_FILE_FILTERS,
    defaultUri: workspaceFolder?.uri,
  });
  if (!uris || uris.length === 0) return;

  const specText = await readSpecFromFileUri(uris[0]);
  await runGeneration(specText, vscode.workspace.asRelativePath(uris[0]));
}

export async function generateFromExplorerCommand(resource?: vscode.Uri): Promise<void> {
  if (!resource) {
    await generateFromFileCommand();
    return;
  }
  const specText = await readSpecFromFileUri(resource);
  await runGeneration(specText, vscode.workspace.asRelativePath(resource));
}

export async function generateFromUrlCommand(): Promise<void> {
  const url = await vscode.window.showInputBox({
    prompt: 'URL of the OpenAPI/Swagger spec (JSON or YAML)',
    placeHolder: 'https://api.example.com/openapi.json',
    validateInput: (value) => {
      if (!value.trim()) return 'Enter a URL.';
      try {
        const parsed = new URL(value.trim());
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'URL must start with http:// or https://';
      } catch {
        return 'Not a valid URL.';
      }
      return undefined;
    },
  });
  if (!url) return;

  let specText: string;
  try {
    specText = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `PlaySpec: fetching ${url}...` },
      () => fetchText(url.trim())
    );
  } catch (err) {
    if (err instanceof FetchError) {
      vscode.window.showErrorMessage(`PlaySpec: ${err.message}`);
      return;
    }
    throw err;
  }

  await runGeneration(specText, url);
}
