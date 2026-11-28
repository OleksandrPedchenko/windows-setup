import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { ResolvedArtifact } from './providers.js';

export type LockEntry = Pick<ResolvedArtifact, 'filename' | 'version' | 'sha256' | 'sizeBytes'>;
export type Lock = Record<string, LockEntry>;
export type Status = 'previously-unresolved' | 'up-to-date' | 'version-changed' | 'refreshed-image' | 'upstream-image-changed' | 'identity-unknown';

const hash = /^[a-f\d]{64}$/i;

export function compare(previous: LockEntry | undefined, current: LockEntry): Status {
  if (!previous) return 'previously-unresolved';
  if (previous.version && current.version && previous.version !== current.version) return 'version-changed';
  if (previous.sha256 && current.sha256) {
    if (previous.sha256.toLowerCase() !== current.sha256.toLowerCase()) return previous.version === current.version ? 'refreshed-image' : 'upstream-image-changed';
    return 'up-to-date';
  }
  if (previous.filename !== current.filename || (previous.sizeBytes && current.sizeBytes && previous.sizeBytes !== current.sizeBytes)) return 'upstream-image-changed';
  return 'identity-unknown';
}

function validateEntry(value: unknown): LockEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid lock entry');
  const entry = value as Record<string, unknown>;
  if (typeof entry.filename !== 'string' || !entry.filename || /[/\\]/.test(entry.filename)) throw new Error('invalid lock filename');
  if (entry.version !== undefined && (typeof entry.version !== 'string' || !entry.version)) throw new Error('invalid lock version');
  if (entry.sha256 !== undefined && (typeof entry.sha256 !== 'string' || !hash.test(entry.sha256))) throw new Error('invalid lock checksum');
  if (entry.sizeBytes !== undefined && (!Number.isSafeInteger(entry.sizeBytes) || (entry.sizeBytes as number) <= 0)) throw new Error('invalid lock size');
  const clean: LockEntry = { filename: entry.filename };
  if (entry.version) clean.version = entry.version as string;
  if (entry.sha256) clean.sha256 = (entry.sha256 as string).toLowerCase();
  if (entry.sizeBytes) clean.sizeBytes = entry.sizeBytes as number;
  return clean;
}

export async function readLock(path: string): Promise<Lock> {
  let text: string;
  try { text = await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  const raw = JSON.parse(text) as { schemaVersion?: unknown; artifacts?: unknown };
  if (raw.schemaVersion !== 1 || !raw.artifacts || typeof raw.artifacts !== 'object' || Array.isArray(raw.artifacts)) throw new Error('unsupported lock file');
  return Object.fromEntries(Object.entries(raw.artifacts).map(([key, value]) => {
    if (!key || key.startsWith('/') || key.split('/').some(part => !part || part === '..' || part === '.')) throw new Error(`invalid lock destination: ${key}`);
    return [key, validateEntry(value)];
  }));
}

export async function writeLock(path: string, artifacts: Record<string, ResolvedArtifact | LockEntry>): Promise<void> {
  const sorted = Object.fromEntries(Object.entries(artifacts).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, validateEntry(value)]));
  const content = `${JSON.stringify({ schemaVersion: 1, artifacts: sorted }, null, 2)}\n`;
  try { if (await readFile(path, 'utf8') === content) return; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const temporary = `${path}.${process.pid}.tmp`;
  try { await writeFile(temporary, content); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}
