import * as crypto from 'crypto';

export interface ManifestEntry {
  /** Relative path (from the project root) of the file generated for this operation. */
  file: string;
  /** sha256 of that file's generated content, as of the last generation. */
  hash: string;
}

export interface Manifest {
  version: 1;
  /** Keyed by operationKey ("METHOD /path"). */
  operations: Record<string, ManifestEntry>;
  /**
   * sha256 of each "written once" scaffold file (playwright.config.ts,
   * .env.sample, README.md, tests/helpers/*) as of the last time PlaySpec
   * itself wrote it — keyed by its relative path. Lets a later PlaySpec
   * version pick up an improved template on regeneration (e.g. a
   * playwright.config.ts bugfix) when the file on disk still matches what
   * PlaySpec last wrote, while leaving it alone the moment it doesn't (the
   * user edited it) — same content-hash-gated approach as `operations`
   * above, just applied to scaffold files instead of per-operation ones.
   * Absent on a manifest written before this existed; treated as `{}`.
   */
  scaffoldHashes: Record<string, string>;
}

export function emptyManifest(): Manifest {
  return { version: 1, operations: {}, scaffoldHashes: {} };
}

/**
 * Content hash used to detect whether an operation's generated test file
 * would come out any different this time around. If it wouldn't, the file on
 * disk (which may since have been hand-edited) is left alone; if it would,
 * the operation is treated as changed and its file is rewritten.
 */
export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}
