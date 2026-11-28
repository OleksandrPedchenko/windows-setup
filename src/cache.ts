import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { fetchHttps, type ResolvedArtifact } from './providers.js';
import type { LockEntry } from './lock.js';

export interface CachedArtifact {
  path: string;
  sha256: string;
  verifiedAgainstUpstream: boolean;
  reused: boolean;
}

export function defaultCacheRoot(): string {
  return process.env.VENTOY_TOOLKIT_CACHE || (process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || homedir(), 'ventoy-toolkit')
    : join(homedir(), '.cache', 'ventoy-toolkit'));
}

async function fileHash(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function readIndex(path: string): Promise<Record<string, string>> {
  try { return JSON.parse(await readFile(path, 'utf8')) as Record<string, string>; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
}

export async function downloadToCache(destination: string, artifact: ResolvedArtifact, cacheRoot: string = defaultCacheRoot(), fetcher: typeof fetch = fetch, onProgress?: (received: number, total?: number) => void): Promise<CachedArtifact> {
  if (!artifact.downloadUrl || new URL(artifact.downloadUrl).protocol !== 'https:') throw new Error('download requires an HTTPS URL');
  const artifacts = join(cacheRoot, 'artifacts');
  const temporary = join(cacheRoot, 'temporary');
  const indexPath = join(cacheRoot, 'index.json');
  await mkdir(artifacts, { recursive: true });
  await mkdir(temporary, { recursive: true });
  const sourceId = createHash('sha256').update(artifact.downloadUrl).digest('hex');
  const key = JSON.stringify([destination, artifact.filename, artifact.version, artifact.sizeBytes, sourceId]);
  const index = artifact.sha256 ? {} : await readIndex(indexPath);
  const candidate = artifact.sha256 || index[key];
  if (candidate && /^[a-f\d]{64}$/i.test(candidate)) {
    const path = join(artifacts, candidate.toLowerCase());
    try {
      if ((!artifact.sizeBytes || (await stat(path)).size === artifact.sizeBytes) && await fileHash(path) === candidate.toLowerCase()) return { path, sha256: candidate.toLowerCase(), verifiedAgainstUpstream: !!artifact.sha256, reused: true };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const response = await fetchHttps(artifact.downloadUrl, fetcher);
  if (!response.ok || !response.body) throw new Error(`download HTTP ${response.status}`);
  const partial = join(temporary, `${randomUUID()}.part`);
  const hash = createHash('sha256');
  let size = 0;
  let lastProgress = Date.now();
  const headerSize = Number(response.headers.get('content-length'));
  const total = artifact.sizeBytes || (Number.isSafeInteger(headerSize) && headerSize > 0 ? headerSize : undefined);
  try {
    await pipeline(
      Readable.fromWeb(response.body as ReadableStream),
      new Transform({ transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        size += chunk.length;
        if (onProgress && Date.now() - lastProgress >= 2000) { onProgress(size, total); lastProgress = Date.now(); }
        callback(null, chunk);
      } }),
      createWriteStream(partial, { flags: 'wx' }),
    );
    onProgress?.(size, total);
    const actual = hash.digest('hex');
    if (size === 0) throw new Error('empty download');
    if (artifact.sizeBytes && size !== artifact.sizeBytes) throw new Error(`size mismatch: expected ${artifact.sizeBytes}, got ${size}`);
    if (artifact.sha256 && actual !== artifact.sha256.toLowerCase()) throw new Error('checksum mismatch');
    const path = join(artifacts, actual);
    try { await rename(partial, path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await fileHash(path) !== actual) throw new Error('cache hash collision');
    }
    if (!artifact.sha256) {
      index[key] = actual;
      const indexTemporary = `${indexPath}.${randomUUID()}.tmp`;
      try { await writeFile(indexTemporary, `${JSON.stringify(index, null, 2)}\n`); await rename(indexTemporary, indexPath); }
      finally { await rm(indexTemporary, { force: true }); }
    }
    return { path, sha256: actual, verifiedAgainstUpstream: !!artifact.sha256, reused: false };
  } finally { await rm(partial, { force: true }); }
}

export async function importToCache(destination: string, source: string, locked: LockEntry, cacheRoot: string = defaultCacheRoot(), onProgress?: (received: number, total: number) => void): Promise<CachedArtifact> {
  if (!locked.sha256) throw new Error(`${destination} has no official SHA-256 in the lock`);
  const input = await lstat(source);
  if (!input.isFile()) throw new Error('import source must be a regular file, not a symlink or directory');
  const artifacts = join(cacheRoot, 'artifacts');
  const temporary = join(cacheRoot, 'temporary');
  await mkdir(artifacts, { recursive: true });
  await mkdir(temporary, { recursive: true });
  const partial = join(temporary, `${randomUUID()}.part`);
  const hash = createHash('sha256');
  let size = 0;
  let lastProgress = Date.now();
  try {
    await pipeline(
      createReadStream(source),
      new Transform({ transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        size += chunk.length;
        if (onProgress && Date.now() - lastProgress >= 2000) { onProgress(size, input.size); lastProgress = Date.now(); }
        callback(null, chunk);
      } }),
      createWriteStream(partial, { flags: 'wx' }),
    );
    onProgress?.(size, input.size);
    if (!size) throw new Error('empty import');
    if (locked.sizeBytes && size !== locked.sizeBytes) throw new Error(`size mismatch: expected ${locked.sizeBytes}, got ${size}`);
    const actual = hash.digest('hex');
    if (actual !== locked.sha256) throw new Error(`checksum mismatch for ${destination}`);
    const path = join(artifacts, actual);
    try {
      if ((await stat(path)).size === size && await fileHash(path) === actual) return { path, sha256: actual, verifiedAgainstUpstream: true, reused: true };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await rename(partial, path);
    return { path, sha256: actual, verifiedAgainstUpstream: true, reused: false };
  } finally { await rm(partial, { force: true }); }
}
