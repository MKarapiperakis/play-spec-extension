import * as vscode from 'vscode';
import { validateSpecText } from '../parser/validateSpec';
import { fetchText, FetchError } from '../utils/fetchText';
import { showValidationReport } from '../views/validationReportPanel';

const SPEC_FILE_FILTERS = { 'OpenAPI/Swagger spec': ['json', 'yaml', 'yml'] };

async function readSpecFromFileUri(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString('utf8');
}

async function runValidation(specText: string, sourceLabel: string): Promise<void> {
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `PlaySpec: validating ${sourceLabel}...`, cancellable: false },
    () => validateSpecText(specText)
  );

  showValidationReport(result, sourceLabel);

  if (!result.categories) {
    // Parsing/dereferencing failed outright — the webview shows the single
    // top-level error, but surface it as a notification too since it's the
    // only signal in that case.
    vscode.window.showErrorMessage(`PlaySpec: ${result.errors[0]?.message || 'This spec could not be validated.'}`);
    return;
  }

  const message = result.canGenerate
    ? `PlaySpec: spec looks good (score ${result.score}/100, ${result.warnings.length} warning(s)).`
    : `PlaySpec: spec has ${result.errors.length} error(s) that will block generation (score ${result.score}/100).`;

  if (result.canGenerate) {
    vscode.window.showInformationMessage(message);
  } else {
    vscode.window.showWarningMessage(message);
  }
}

export async function validateFromFileCommand(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: 'Validate This Spec',
    filters: SPEC_FILE_FILTERS,
    defaultUri: workspaceFolder?.uri,
  });
  if (!uris || uris.length === 0) return;

  const specText = await readSpecFromFileUri(uris[0]);
  await runValidation(specText, vscode.workspace.asRelativePath(uris[0]));
}

export async function validateFromExplorerCommand(resource?: vscode.Uri | { uri: vscode.Uri }): Promise<void> {
  if (!resource) {
    await validateFromFileCommand();
    return;
  }
  // The real Explorer and editor-title button pass a vscode.Uri, but the
  // PlaySpec tree view's inline icons invoke commands with the SpecFileNode
  // tree element instead — unwrap its `uri` (see generateFromExplorerCommand).
  const uri = resource instanceof vscode.Uri ? resource : resource.uri;
  const specText = await readSpecFromFileUri(uri);
  await runValidation(specText, vscode.workspace.asRelativePath(uri));
}

export async function validateFromUrlCommand(): Promise<void> {
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

  await runValidation(specText, url);
}
