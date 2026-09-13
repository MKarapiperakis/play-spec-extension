import * as vscode from 'vscode';
import { findSpecFiles } from '../utils/specDiscovery';
import { findGeneratedTests, GeneratedTestRef } from '../utils/testDiscovery';

const MAX_DISPLAYED = 100;

class ActionNode {
  readonly kind = 'action' as const;
  constructor(
    public readonly label: string,
    public readonly icon: string,
    public readonly command: string,
    public readonly args: any[] = []
  ) {}
}

class SpecFilesGroupNode {
  readonly kind = 'group' as const;
}

class SpecFileNode {
  readonly kind = 'specFile' as const;
  constructor(
    public readonly uri: vscode.Uri,
    public readonly relativePath: string
  ) {}
}

class GeneratedTestsGroupNode {
  readonly kind = 'testsGroup' as const;
}

class TestTagGroupNode {
  readonly kind = 'testTagGroup' as const;
  constructor(
    public readonly label: string,
    public readonly tests: GeneratedTestRef[]
  ) {}
}

class TestFileNode {
  readonly kind = 'testFile' as const;
  constructor(public readonly ref: GeneratedTestRef) {}
}

class InfoNode {
  readonly kind = 'info' as const;
  constructor(public readonly label: string) {}
}

type PlaySpecNode =
  | ActionNode
  | SpecFilesGroupNode
  | SpecFileNode
  | GeneratedTestsGroupNode
  | TestTagGroupNode
  | TestFileNode
  | InfoNode;

/** Codicon per HTTP method, so the generated-tests list is scannable at a glance without reading each label fully. */
function methodIcon(operationKey: string): string {
  switch (operationKey.split(' ')[0]) {
    case 'GET':
      return 'arrow-down';
    case 'POST':
      return 'add';
    case 'PUT':
      return 'arrow-up';
    case 'PATCH':
      return 'edit';
    case 'DELETE':
      return 'trash';
    default:
      return 'symbol-method';
  }
}

/**
 * Activity Bar tree: quick-launch actions at the root (generate from a
 * picked file, generate from a URL, jump to this extension's settings),
 * an auto-discovered, auto-refreshing list of spec-looking files already in
 * the workspace (one click generates straight from one), and a list of
 * already-generated tests read from each project's PlaySpec manifest (one
 * click opens the file, inline buttons run/debug it via the Playwright CLI).
 */
export class SpecExplorerProvider implements vscode.TreeDataProvider<PlaySpecNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: PlaySpecNode): vscode.TreeItem {
    switch (node.kind) {
      case 'action': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(node.icon);
        item.command = { command: node.command, title: node.label, arguments: node.args };
        return item;
      }
      case 'group': {
        const item = new vscode.TreeItem('Spec Files in Workspace', vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon('files');
        return item;
      }
      case 'specFile': {
        const item = new vscode.TreeItem(node.relativePath, vscode.TreeItemCollapsibleState.None);
        item.resourceUri = node.uri; // lets VS Code show the file-type icon from the active icon theme
        item.contextValue = 'playspec.specFile';
        item.tooltip = `${node.relativePath}\nClick to open, or use the inline buttons to generate Playwright tests or validate it.`;
        item.command = { command: 'vscode.open', title: 'Open Spec File', arguments: [node.uri] };
        return item;
      }
      case 'testsGroup': {
        const item = new vscode.TreeItem('Generated Tests', vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon('beaker');
        item.contextValue = 'playspec.testsGroup';
        item.tooltip = 'Generated tests, grouped by tag. Use the inline button to open the last test run\'s HTML report.';
        return item;
      }
      case 'testTagGroup': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon('folder');
        return item;
      }
      case 'testFile': {
        const { ref } = node;
        const item = new vscode.TreeItem(ref.operationKey, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(methodIcon(ref.operationKey));
        item.contextValue = 'playspec.testFile';
        item.tooltip = `${ref.relativePath}\nClick to open, or use the inline buttons to run or debug this test.`;
        item.command = { command: 'vscode.open', title: 'Open Test File', arguments: [ref.fileUri] };
        return item;
      }
      case 'info': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('info');
        return item;
      }
    }
  }

  async getChildren(element?: PlaySpecNode): Promise<PlaySpecNode[]> {
    if (!element) {
      return [
        new ActionNode('Generate from Spec File...', 'folder-opened', 'playspec.generateFromFile'),
        new ActionNode('Generate from Spec URL...', 'link', 'playspec.generateFromUrl'),
        new ActionNode('Validate Spec File...', 'check', 'playspec.validateFromFile'),
        new ActionNode('Validate Spec URL...', 'cloud', 'playspec.validateFromUrl'),
        new ActionNode('Open PlaySpec Settings', 'gear', 'workbench.action.openSettings', ['@ext:playspec.playspec']),
        new SpecFilesGroupNode(),
        new GeneratedTestsGroupNode(),
      ];
    }

    if (element.kind === 'group') {
      if (!vscode.workspace.workspaceFolders?.length) {
        return [new InfoNode('Open a folder to see spec files here')];
      }

      const files = await findSpecFiles();
      if (!files.length) {
        return [new InfoNode('No OpenAPI/Swagger spec files found')];
      }

      const shown: PlaySpecNode[] = files.slice(0, MAX_DISPLAYED).map((f) => new SpecFileNode(f.uri, f.relativePath));
      if (files.length > MAX_DISPLAYED) {
        shown.push(new InfoNode(`+${files.length - MAX_DISPLAYED} more not shown`));
      }
      return shown;
    }

    if (element.kind === 'testsGroup') {
      if (!vscode.workspace.workspaceFolders?.length) {
        return [new InfoNode('Open a folder to see generated tests here')];
      }

      const refs = await findGeneratedTests();
      if (!refs.length) {
        return [new InfoNode('No generated tests found — generate from a spec first')];
      }

      const multiFolder = new Set(refs.map((r) => r.workspaceFolder)).size > 1;
      const byTag = new Map<string, GeneratedTestRef[]>();
      for (const ref of refs) {
        const tagLabel = multiFolder ? `${ref.workspaceFolder.name}: ${ref.tag}` : ref.tag;
        if (!byTag.has(tagLabel)) byTag.set(tagLabel, []);
        byTag.get(tagLabel)!.push(ref);
      }

      return [...byTag.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, tests]) => new TestTagGroupNode(label, tests));
    }

    if (element.kind === 'testTagGroup') {
      return [...element.tests].sort((a, b) => a.operationKey.localeCompare(b.operationKey)).map((ref) => new TestFileNode(ref));
    }

    return [];
  }
}
