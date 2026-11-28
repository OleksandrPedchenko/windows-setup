import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import type { ResolvedArtifact } from './providers.js';

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
  const key = JSON.stringify([destination, artifact.filename, artifact.version, artifact.sizeBytes]);
  const index = artifact.sha256 ? {} : await readIndex(indexPath);
  const candidate = artifact.sha256 || index[key];
  if (candidate && /^[a-f\d]{64}$/i.test(candidate)) {
    const path = join(artifacts, candidate.toLowerCase());
    try {
      if ((!artifact.sizeBytes || (await stat(path)).size === artifact.sizeBytes) && await fileHash(path) === candidate.toLowerCase()) return { path, sha256: candidate.toLowerCase(), verifiedAgainstUpstream: !!artifact.sha256, reused: true };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const response = await fetcher(artifact.downloadUrl);
  if (!response.ok || !response.body) throw new Error(`download HTTP ${response.status}`);
  if (response.url && new URL(response.url).protocol !== 'https:') throw new Error('download redirected to a non-HTTPS URL');
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
