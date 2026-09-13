import * as vscode from 'vscode';
import { fileExists } from './fsHelpers';

// One terminal per generated project (keyed by its root folder), reused
// across runs instead of spawning a new one every click — same idea as
// letting a user keep a single terminal tab per project themselves.
const terminals = new Map<string, vscode.Terminal>();

function terminalFor(projectRootUri: vscode.Uri, projectLabel: string): vscode.Terminal {
  const key = projectRootUri.toString();
  const existing = terminals.get(key);
  if (existing && existing.exitStatus === undefined) return existing;

  const terminal = vscode.window.createTerminal({ name: `PlaySpec: ${projectLabel}`, cwd: projectRootUri });
  terminals.set(key, terminal);
  return terminal;
}

/** Runs a single generated test file via the Playwright CLI in a reused integrated terminal. */
export function runGeneratedTest(projectRootUri: vscode.Uri, projectLabel: string, relativePath: string): void {
  const terminal = terminalFor(projectRootUri, projectLabel);
  terminal.show();
  terminal.sendText(`npx playwright test "${relativePath}"`);
}

/**
 * Debugs a single generated test file by launching the Playwright CLI
 * directly under VS Code's own Node debugger, rather than shelling out to
 * `playwright test --debug` — that flag only opens Playwright's own Inspector
 * (a browser-side step-through tool) in a plain, undebugged terminal process,
 * which editor breakpoints can never reach, and these are pure HTTP
 * `request`-fixture tests anyway (no browser involved — see the generated
 * playwright.config.ts). This is Playwright's own documented recipe for VS
 * Code breakpoint debugging without the official Playwright extension
 * (https://playwright.dev/docs/debug#vs-code-debugger): once it detects an
 * attached debugger, the test runner forces a single in-process worker so the
 * test actually runs in the process VS Code is attached to, instead of an
 * unreachable forked worker.
 */
export async function debugGeneratedTest(projectRootUri: vscode.Uri, relativePath: string): Promise<void> {
  const cliUri = vscode.Uri.joinPath(projectRootUri, 'node_modules', '@playwright', 'test', 'cli.js');
  if (!(await fileExists(cliUri))) {
    vscode.window.showErrorMessage(
      `PlaySpec: dependencies aren't installed in this project yet — run "npm install" in ${projectRootUri.fsPath} first.`
    );
    return;
  }

  await vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(projectRootUri), {
    type: 'node',
    request: 'launch',
    name: `PlaySpec: Debug ${relativePath}`,
    program: cliUri.fsPath,
    args: ['test', relativePath],
    cwd: projectRootUri.fsPath,
    console: 'integratedTerminal',
    internalConsoleOptions: 'neverOpen',
  });
}
