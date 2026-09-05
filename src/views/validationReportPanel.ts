import * as vscode from 'vscode';
import { ValidationResult, Category, Issue } from '../parser/validateSpec';

let extensionUri: vscode.Uri | undefined;

/** Called once from activate() so this module can resolve the extension's own resources (icon). */
export function initValidationReportPanel(uri: vscode.Uri): void {
  extensionUri = uri;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function badgeFor(status: 'pass' | 'warning' | 'error'): string {
  if (status === 'error') return '<span class="badge badge-error">Error</span>';
  if (status === 'warning') return '<span class="badge badge-warning">Warning</span>';
  return '<span class="badge badge-pass">Pass</span>';
}

function renderIssue(issue: Issue): string {
  // issue.message already carries a human-readable location (see
  // humanizePointer in validateSpec.ts) — issue.path is the raw JSON
  // pointer/internal key behind it, useful for programmatic consumers but
  // redundant and, for ajv-sourced errors, full of confusing "~1" escapes
  // when shown to a person. Not rendered here for that reason.
  const icon = issue.severity === 'error' ? '✖' : '⚠';
  return `<li class="issue issue-${issue.severity}"><span class="issue-icon">${icon}</span><span class="issue-message">${escapeHtml(issue.message)}</span></li>`;
}

function renderCategory(cat: Category): string {
  const body = cat.issues.length
    ? `<ul class="issue-list">${cat.issues.map(renderIssue).join('')}</ul>`
    : `<p class="no-issues">No issues found.</p>`;
  return `
    <section class="category">
      <h3>${escapeHtml(cat.label)} ${badgeFor(cat.status)}</h3>
      ${body}
    </section>`;
}

function renderEndpoints(endpoints: Record<string, { path: string; summary: string | null }[]>): string {
  const methods = Object.keys(endpoints);
  if (!methods.length) return '<p class="no-issues">No endpoints found.</p>';
  return methods
    .map((method) => {
      const rows = endpoints[method]
        .map(
          (e) =>
            `<li><span class="method method-${method}">${method.toUpperCase()}</span> <code>${escapeHtml(e.path)}</code>${
              e.summary ? ` — ${escapeHtml(e.summary)}` : ''
            }</li>`
        )
        .join('');
      return `<ul class="endpoint-list">${rows}</ul>`;
    })
    .join('');
}

function renderReportHtml(result: ValidationResult, sourceLabel: string, iconSrc: string | null): string {
  const { summary } = result;
  const severityClass = result.severity === 'good' ? 'good' : result.severity === 'medium' ? 'medium' : 'bad';

  const summaryHtml = summary
    ? `
    <section class="summary-grid">
      <div><span class="label">Title</span><span>${escapeHtml(summary.title || '—')}</span></div>
      <div><span class="label">Spec version</span><span>${escapeHtml(summary.specVersion || '—')}</span></div>
      <div><span class="label">Paths / Operations</span><span>${summary.pathCount} / ${summary.operationCount}</span></div>
      <div><span class="label">Base URL declared</span><span>${summary.hasBaseUrl ? 'Yes' : 'No'}</span></div>
      <div><span class="label">Security schemes</span><span>${
        summary.securitySchemes.length ? summary.securitySchemes.map((s) => `${escapeHtml(s.name)} (${escapeHtml(s.type)})`).join(', ') : '—'
      }</span></div>
    </section>
    <section class="category">
      <h3>Endpoints</h3>
      ${renderEndpoints(summary.endpoints)}
    </section>`
    : '';

  const categoriesHtml = result.categories ? result.categories.map(renderCategory).join('') : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 20px 20px; }
  .app-icon { position: fixed; top: 16px; right: 20px; width: 32px; height: 32px; border-radius: 6px; }
  .title-row { display: flex; align-items: baseline; gap: 10px; margin: 12px 0 20px; }
  h1 { font-size: 1.3em; margin: 0; }
  h3 { margin-bottom: 6px; }
  .source { color: var(--vscode-descriptionForeground); }
  .score-row { display: flex; align-items: center; gap: 16px; margin: 12px 0 20px; }
  .score { font-size: 2em; font-weight: 600; }
  .score.good { color: var(--vscode-testing-iconPassed, #2ea043); }
  .score.medium { color: var(--vscode-editorWarning-foreground, #d29922); }
  .score.bad { color: var(--vscode-testing-iconFailed, #f85149); }
  .pill { padding: 2px 10px; border-radius: 12px; font-size: 0.85em; }
  .pill.good { background: rgba(46,160,67,0.15); color: var(--vscode-testing-iconPassed, #2ea043); }
  .pill.medium { background: rgba(210,153,34,0.15); color: var(--vscode-editorWarning-foreground, #d29922); }
  .pill.bad { background: rgba(248,81,73,0.15); color: var(--vscode-testing-iconFailed, #f85149); }
  .summary-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px 20px; margin-bottom: 20px; padding: 12px; border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3)); border-radius: 6px; }
  .summary-grid > div { display: flex; flex-direction: column; }
  .label { font-size: 0.8em; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.03em; }
  .category { margin-bottom: 18px; }
  .badge { font-size: 0.75em; padding: 1px 8px; border-radius: 10px; vertical-align: middle; }
  .badge-error { background: rgba(248,81,73,0.15); color: var(--vscode-testing-iconFailed, #f85149); }
  .badge-warning { background: rgba(210,153,34,0.15); color: var(--vscode-editorWarning-foreground, #d29922); }
  .badge-pass { background: rgba(46,160,67,0.15); color: var(--vscode-testing-iconPassed, #2ea043); }
  .issue-list { list-style: none; padding: 0; margin: 6px 0 0; }
  .issue { display: flex; align-items: baseline; gap: 8px; padding: 6px 8px; border-radius: 4px; margin-bottom: 4px; }
  .issue-error { background: rgba(248,81,73,0.08); }
  .issue-warning { background: rgba(210,153,34,0.08); }
  .issue-icon { flex: none; }
  .issue-error .issue-icon { color: var(--vscode-testing-iconFailed, #f85149); }
  .issue-warning .issue-icon { color: var(--vscode-editorWarning-foreground, #d29922); }
  .issue-message { flex: 1 1 auto; }
  .issue-path, code { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85em; color: var(--vscode-descriptionForeground); background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.15)); padding: 1px 5px; border-radius: 4px; }
  .no-issues { color: var(--vscode-descriptionForeground); font-style: italic; margin: 4px 0 0; }
  .endpoint-list { list-style: none; padding: 0; margin: 4px 0; }
  .endpoint-list li { padding: 2px 0; }
  .method { font-size: 0.75em; font-weight: 600; padding: 1px 6px; border-radius: 4px; margin-right: 6px; }
  .method-get { background: rgba(46,160,67,0.15); color: #2ea043; }
  .method-post { background: rgba(56,139,253,0.15); color: #388bfd; }
  .method-put { background: rgba(210,153,34,0.15); color: #d29922; }
  .method-patch { background: rgba(163,113,247,0.15); color: #a371f7; }
  .method-delete { background: rgba(248,81,73,0.15); color: #f85149; }
</style>
</head>
<body>
  ${iconSrc ? `<img class="app-icon" src="${iconSrc}" alt="" />` : ''}
  <div class="title-row">
    <h1>PlaySpec Validation Report</h1>
    <span class="source">| ${escapeHtml(sourceLabel)}</span>
  </div>
  <div class="score-row">
    <span class="score ${severityClass}">${result.score}</span>
    <span class="pill ${severityClass}">${result.canGenerate ? 'Ready to generate' : 'Has blocking errors'}</span>
    <span>${result.errors.length} error(s), ${result.warnings.length} warning(s)</span>
  </div>
  ${summaryHtml}
  ${categoriesHtml}
</body>
</html>`;
}

export function showValidationReport(result: ValidationResult, sourceLabel: string): void {
  const resourcesUri = extensionUri ? vscode.Uri.joinPath(extensionUri, 'resources') : undefined;
  const iconUri = resourcesUri ? vscode.Uri.joinPath(resourcesUri, 'icon-128.png') : undefined;

  const panel = vscode.window.createWebviewPanel(
    'playspec.validationReport',
    `PlaySpec Validation: ${sourceLabel}`,
    vscode.ViewColumn.Beside,
    { enableScripts: false, localResourceRoots: resourcesUri ? [resourcesUri] : undefined }
  );
  if (iconUri) panel.iconPath = iconUri;

  const iconSrc = iconUri ? panel.webview.asWebviewUri(iconUri).toString() : null;
  panel.webview.html = renderReportHtml(result, sourceLabel, iconSrc);
}
