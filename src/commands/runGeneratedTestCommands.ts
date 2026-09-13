import * as vscode from 'vscode';
import { runGeneratedTest, debugGeneratedTest } from '../utils/testRunner';

// Invoked from the "Generated Tests" section's inline Run/Debug buttons
// (view/item/context), which VS Code calls with the tree element itself as
// the sole argument — same pattern as generateFromExplorerCommand's resource
// param, just shaped like TestFileNode (see specTreeProvider.ts) instead of
// SpecFileNode.
interface TestFileNodeLike {
  ref: {
    projectRootUri: vscode.Uri;
    projectLabel: string;
    relativePath: string;
  };
}

export function runGeneratedTestCommand(node: TestFileNodeLike): void {
  runGeneratedTest(node.ref.projectRootUri, node.ref.projectLabel, node.ref.relativePath);
}

export function debugGeneratedTestCommand(node: TestFileNodeLike): Promise<void> {
  return debugGeneratedTest(node.ref.projectRootUri, node.ref.relativePath);
}
