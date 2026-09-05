import * as vscode from 'vscode';
import { generateFromFileCommand, generateFromUrlCommand, generateFromExplorerCommand } from './commands/generateTests';
import { validateFromFileCommand, validateFromUrlCommand, validateFromExplorerCommand } from './commands/validateSpecCommands';
import { SpecExplorerProvider } from './views/specTreeProvider';
import { initValidationReportPanel } from './views/validationReportPanel';

export function activate(context: vscode.ExtensionContext): void {
  initValidationReportPanel(context.extensionUri);

  context.subscriptions.push(
    vscode.commands.registerCommand('playspec.generateFromFile', generateFromFileCommand),
    vscode.commands.registerCommand('playspec.generateFromUrl', generateFromUrlCommand),
    vscode.commands.registerCommand('playspec.generateFromExplorer', generateFromExplorerCommand),
    vscode.commands.registerCommand('playspec.validateFromFile', validateFromFileCommand),
    vscode.commands.registerCommand('playspec.validateFromUrl', validateFromUrlCommand),
    vscode.commands.registerCommand('playspec.validateFromExplorer', validateFromExplorerCommand)
  );

  const specExplorer = new SpecExplorerProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('playspec.specExplorer', specExplorer),
    vscode.commands.registerCommand('playspec.refreshSpecExplorer', () => specExplorer.refresh())
  );

  // Keep the spec-file list current as files are added/removed/edited, without
  // requiring a manual refresh click every time. Debounced because this glob
  // has no exclude option (unlike findFiles) — something like `npm install`
  // touching many files under node_modules could otherwise fire a refresh,
  // and its workspace re-scan, per file instead of once for the whole burst.
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => specExplorer.refresh(), 500);
  };

  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{json,yaml,yml}');
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(scheduleRefresh),
    watcher.onDidDelete(scheduleRefresh),
    watcher.onDidChange(scheduleRefresh),
    vscode.workspace.onDidChangeWorkspaceFolders(scheduleRefresh),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('playspec.outputFolderName')) scheduleRefresh();
    }),
    { dispose: () => refreshTimer && clearTimeout(refreshTimer) }
  );
}

export function deactivate(): void {}
