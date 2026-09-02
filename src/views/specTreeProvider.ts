import * as vscode from 'vscode';
import { findSpecFiles } from '../utils/specDiscovery';

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

class InfoNode {
  readonly kind = 'info' as const;
  constructor(public readonly label: string) {}
}

type PlaySpecNode = ActionNode | SpecFilesGroupNode | SpecFileNode | InfoNode;

/**
 * Activity Bar tree: quick-launch actions at the root (generate from a
 * picked file, generate from a URL, jump to this extension's settings),
 * plus an auto-discovered, auto-refreshing list of spec-looking files
 * already in the workspace — one click generates straight from one.
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
        item.tooltip = `${node.relativePath}\nClick to open, or use the play button to generate Playwright tests from it.`;
        item.command = { command: 'vscode.open', title: 'Open Spec File', arguments: [node.uri] };
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
        new ActionNode('Open PlaySpec Settings', 'gear', 'workbench.action.openSettings', ['@ext:playspec.playspec']),
        new SpecFilesGroupNode(),
      ];
    }

    if (element.kind !== 'group') return [];

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
}
