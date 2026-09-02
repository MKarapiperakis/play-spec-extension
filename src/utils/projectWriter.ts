import * as vscode from 'vscode';
import { BuiltProject } from '../generator/httpProject/build';
import { renderParamsFile } from '../generator/paramsData';
import { Manifest, emptyManifest, hashContent } from '../generator/manifest';
import { fileExists, readTextFile, writeTextFile, joinPath } from './fsHelpers';

export const MANIFEST_RELATIVE_PATH = 'tests/spec/.playspec-manifest.json';
const PARAMS_RELATIVE_PATH = 'tests/data/params.ts';

export interface WriteSummary {
  scaffoldCreated: string[];
  operationsCreated: string[];
  operationsUpdated: string[];
  operationsUnchanged: number;
  /** Files that no longer correspond to any current operation — left in place, never deleted. */
  operationsOrphaned: string[];
  paramsCreated: boolean;
  paramsMerged: boolean;
  /** true if an existing params.ts couldn't be parsed (likely hand-edited beyond our format) — left untouched. */
  paramsUnparseable: boolean;
  paramsNewKeys: string[];
  paramsDroppedKeys: string[];
}

function emptySummary(): WriteSummary {
  return {
    scaffoldCreated: [],
    operationsCreated: [],
    operationsUpdated: [],
    operationsUnchanged: 0,
    operationsOrphaned: [],
    paramsCreated: false,
    paramsMerged: false,
    paramsUnparseable: false,
    paramsNewKeys: [],
    paramsDroppedKeys: [],
  };
}

async function readManifest(rootUri: vscode.Uri): Promise<Manifest> {
  const text = await readTextFile(joinPath(rootUri, MANIFEST_RELATIVE_PATH));
  if (!text) return emptyManifest();
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && parsed.operations && typeof parsed.operations === 'object') {
      return parsed as Manifest;
    }
  } catch {
    // Corrupt/hand-edited manifest — treat this as if it were a first generation
    // rather than failing outright; every operation file will simply be
    // (re)written and a fresh manifest recorded.
  }
  return emptyManifest();
}

async function writeManifest(rootUri: vscode.Uri, manifest: Manifest): Promise<void> {
  await writeTextFile(joinPath(rootUri, MANIFEST_RELATIVE_PATH), JSON.stringify(manifest, null, 2) + '\n');
}

/**
 * Additive-only merge for package.json: adds any script/dependency PlaySpec
 * generates that's missing, but never touches or removes anything already
 * there, so hand-added scripts or extra dependencies always survive.
 * Returns undefined if nothing needs to change, or the file can't be parsed
 * as JSON (left untouched in that case).
 */
function mergePackageJson(existingText: string, freshText: string): string | undefined {
  let existing: any;
  let fresh: any;
  try {
    existing = JSON.parse(existingText);
    fresh = JSON.parse(freshText);
  } catch {
    return undefined;
  }

  let changed = false;
  const mergeInto = (key: string) => {
    const merged = { ...(existing[key] || {}) };
    for (const [k, v] of Object.entries(fresh[key] || {})) {
      if (!(k in merged)) {
        merged[k] = v;
        changed = true;
      }
    }
    return merged;
  };

  const scripts = mergeInto('scripts');
  const devDependencies = mergeInto('devDependencies');
  const dependencies = mergeInto('dependencies');
  if (!changed) return undefined;

  return JSON.stringify({ ...existing, scripts, devDependencies, dependencies }, null, 2) + '\n';
}

interface ParamsMergeResult {
  content: string;
  created: boolean;
  merged: boolean;
  unparseable: boolean;
  newKeys: string[];
  droppedKeys: string[];
}

/**
 * Merges freshly-generated placeholder param values into the existing
 * tests/data/params.ts, preserving every value already filled in. Only ever
 * adds a new operation's entry or a new param within an existing entry —
 * existing values are never overwritten, and entries for operations no
 * longer in the spec are dropped (reported via droppedKeys, not silently).
 */
function mergeParamsFile(existingText: string | undefined, fresh: Record<string, Record<string, string>>): ParamsMergeResult {
  if (!existingText) {
    return { content: renderParamsFile(fresh), created: true, merged: false, unparseable: false, newKeys: Object.keys(fresh), droppedKeys: [] };
  }

  // The file is `export const testParams: ... = { ... };` — pull out the
  // object literal, which we always generate as plain JSON (double-quoted,
  // no comments/trailing commas), so it round-trips through JSON.parse.
  const match = existingText.match(/=\s*(\{[\s\S]*\})\s*;\s*$/);
  let existing: Record<string, Record<string, string>> | undefined;
  if (match) {
    try {
      existing = JSON.parse(match[1]);
    } catch {
      existing = undefined;
    }
  }
  if (!existing) {
    return { content: existingText, created: false, merged: false, unparseable: true, newKeys: [], droppedKeys: [] };
  }

  const newKeys: string[] = [];
  const droppedKeys: string[] = [];
  const merged: Record<string, Record<string, string>> = {};
  for (const [key, freshValues] of Object.entries(fresh)) {
    const existingValues = existing[key];
    if (!existingValues) {
      merged[key] = freshValues;
      newKeys.push(key);
      continue;
    }
    // Only keep param names the spec still declares for this operation —
    // spreading existingValues over freshValues (the old approach) could add
    // a renamed param's new name but never remove its old one, since object
    // spread only unions keys and can't delete one. Building the result from
    // freshValues' own key set instead means a param no longer in the spec
    // (renamed or removed) is dropped, while every param still present keeps
    // its existing value if there is one.
    const mergedValues: Record<string, string> = {};
    for (const paramName of Object.keys(freshValues)) {
      mergedValues[paramName] = existingValues[paramName] !== undefined ? existingValues[paramName] : freshValues[paramName];
    }
    merged[key] = mergedValues;
    for (const paramName of Object.keys(existingValues)) {
      if (!(paramName in freshValues)) droppedKeys.push(`${key}.${paramName}`);
    }
  }
  for (const key of Object.keys(existing)) {
    if (!fresh[key]) droppedKeys.push(key);
  }

  const same = JSON.stringify(merged) === JSON.stringify(existing);
  return { content: renderParamsFile(merged), created: false, merged: !same, unparseable: false, newKeys, droppedKeys };
}

/**
 * Writes a generated project into `rootUri`, safe to call repeatedly against
 * an already-generated project:
 *  - scaffold files are only created if missing (package.json instead gets
 *    an additive merge so hand-added scripts/deps survive);
 *  - each operation's test file is only rewritten if its freshly-generated
 *    content actually differs from last time (tracked via a content-hash
 *    manifest) — an operation nothing changed about never has its file
 *    touched, so hand-edits to it are always preserved;
 *  - tests/data/params.ts is merged rather than replaced, so filled-in
 *    values are never lost.
 */
export async function writeProject(rootUri: vscode.Uri, built: BuiltProject): Promise<WriteSummary> {
  const summary = emptySummary();

  for (const [relativePath, freshContent] of Object.entries(built.scaffoldFiles)) {
    const uri = joinPath(rootUri, relativePath);
    if (!(await fileExists(uri))) {
      await writeTextFile(uri, freshContent);
      summary.scaffoldCreated.push(relativePath);
      continue;
    }
    if (relativePath === 'package.json') {
      const existingText = await readTextFile(uri);
      if (existingText) {
        const merged = mergePackageJson(existingText, freshContent);
        if (merged) await writeTextFile(uri, merged);
      }
    }
    // Every other scaffold file: already exists, left exactly as-is.
  }

  const manifest = await readManifest(rootUri);
  const newManifest = emptyManifest();
  const seenKeys = new Set<string>();

  for (const opFile of built.operationFiles) {
    seenKeys.add(opFile.operationKey);
    const hash = hashContent(opFile.content);
    const uri = joinPath(rootUri, opFile.relativePath);
    const priorEntry = manifest.operations[opFile.operationKey];
    const unchanged =
      !!priorEntry && priorEntry.hash === hash && priorEntry.file === opFile.relativePath && (await fileExists(uri));

    if (unchanged) {
      summary.operationsUnchanged++;
    } else {
      await writeTextFile(uri, opFile.content);
      if (priorEntry) summary.operationsUpdated.push(opFile.relativePath);
      else summary.operationsCreated.push(opFile.relativePath);
      // The operation's tag (and so its file path) changed since last time —
      // the old path is now an orphan, distinct from the freshly (re)written one.
      if (priorEntry && priorEntry.file !== opFile.relativePath) {
        summary.operationsOrphaned.push(priorEntry.file);
      }
    }
    newManifest.operations[opFile.operationKey] = { file: opFile.relativePath, hash };
  }

  for (const [key, entry] of Object.entries(manifest.operations)) {
    if (!seenKeys.has(key)) summary.operationsOrphaned.push(entry.file);
  }

  await writeManifest(rootUri, newManifest);

  const paramsUri = joinPath(rootUri, PARAMS_RELATIVE_PATH);
  const existingParamsText = await readTextFile(paramsUri);
  // Run the merge whenever there's something to reconcile: either the spec
  // still has dynamic params (may need creating/updating), or a params.ts
  // already exists (may need entries dropped, even down to none left).
  // Skip only when there's truly nothing on either side.
  if (Object.keys(built.paramsByOperation).length > 0 || existingParamsText !== undefined) {
    const result = mergeParamsFile(existingParamsText, built.paramsByOperation);
    if (result.created || result.merged) {
      await writeTextFile(paramsUri, result.content);
    }
    summary.paramsCreated = result.created;
    summary.paramsMerged = result.merged;
    summary.paramsUnparseable = result.unparseable;
    summary.paramsNewKeys = result.newKeys;
    summary.paramsDroppedKeys = result.droppedKeys;
  }

  return summary;
}
