import * as vscode from 'vscode';
import { generateFromFileCommand, generateFromUrlCommand, generateFromExplorerCommand } from './commands/generateTests';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('playspec.generateFromFile', generateFromFileCommand),
    vscode.commands.registerCommand('playspec.generateFromUrl', generateFromUrlCommand),
    vscode.commands.registerCommand('playspec.generateFromExplorer', generateFromExplorerCommand)
  );
}

export function deactivate(): void {}
