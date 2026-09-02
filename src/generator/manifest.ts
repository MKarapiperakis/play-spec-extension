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
}

export function emptyManifest(): Manifest {
  return { version: 1, operations: {} };
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
