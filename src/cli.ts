import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadToCache, defaultCacheRoot } from './cache.js';
import { discover } from './descriptors.js';
import { compare, readLock, writeLock, type LockEntry } from './lock.js';
import { ManualSourceError, resolveDownloadUrl, resolveMetadata, type ResolvedArtifact } from './providers.js';

interface Options {
  root?: string;
  output?: (line: string) => void;
  fetcher?: typeof fetch;
}

interface CheckResult {
  destination: string;
  status: string;
  previous?: LockEntry;
  current?: LockEntry;
  error?: string;
}

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

function lockEntry(value: ResolvedArtifact): LockEntry {
  return { filename: value.filename, ...(value.version && { version: value.version }), ...(value.sha256 && { sha256: value.sha256 }), ...(value.sizeBytes && { sizeBytes: value.sizeBytes }) };
}

function describe(entry?: LockEntry): string {
  if (!entry) return '-';
  return [`version=${entry.version || '?'}`, `file=${entry.filename}`, `sha256=${entry.sha256 || '?'}`, `size=${entry.sizeBytes === undefined ? '?' : `${entry.sizeBytes} bytes`}`].join(', ');
}

function cell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export async function main(args: string[], options: Options = {}): Promise<number> {
  const root = options.root || repositoryRoot;
  const output = options.output || console.log;
  const fetcher = options.fetcher || fetch;
  const [command, ...rest] = args;
  if (!command || !['list', 'validate', 'check-updates', 'download'].includes(command)) throw new Error('usage: toolkit <list|validate|check-updates|download>');
  const artifacts = await discover(join(root, 'drive'));
  if (command === 'list' || command === 'validate') {
    if (rest.length) throw new Error(`${command} accepts no arguments`);
    if (command === 'validate') output(`Valid: ${artifacts.length} descriptors`);
    else for (const item of artifacts) output(`${item.destination}\t${item.descriptor.name}\t${item.descriptor.source.provider}`);
    return 0;
  }
  const lockPath = join(root, 'toolkit.lock.json');
  const lock = await readLock(lockPath);
  if (command === 'check-updates') {
    let write = false;
    let report: 'text' | 'json' | 'markdown' = 'text';
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--write-lock') write = true;
      else if (rest[i] === '--report' && ['json', 'markdown'].includes(rest[i + 1])) report = rest[++i] as 'json' | 'markdown';
      else throw new Error(`unknown option: ${rest[i]}`);
    }
    const next: Record<string, LockEntry> = {};
    const results: CheckResult[] = [];
    for (const artifact of artifacts) {
      const previous = lock[artifact.destination];
      try {
        const current = lockEntry(await resolveMetadata(artifact.descriptor, fetcher));
        next[artifact.destination] = current;
        results.push({ destination: artifact.destination, status: compare(previous, current), ...(previous && { previous }), current });
      } catch (error) {
        if (previous) next[artifact.destination] = previous;
        results.push({ destination: artifact.destination, status: error instanceof ManualSourceError ? 'manual-check-required' : 'source-unavailable', ...(previous && { previous }), error: error instanceof ManualSourceError ? 'manual download required' : String(error) });
      }
    }
    if (write) await writeLock(lockPath, next);
    if (report === 'json') output(JSON.stringify(results, null, 2));
    else if (report === 'markdown') {
      output('| Destination | Status | Previous | Current | Error |\n|---|---|---|---|---|');
      for (const result of results) output(`| ${cell(result.destination)} | ${result.status} | ${cell(describe(result.previous))} | ${cell(describe(result.current))} | ${cell(result.error || '-')} |`);
    } else for (const result of results) output(`${result.status}\t${result.destination}\told: ${describe(result.previous)}\tnew: ${describe(result.current)}${result.error ? `\terror: ${result.error}` : ''}`);
    return results.some(result => result.status === 'source-unavailable') ? 1 : 0;
  }
  let destination: string | undefined;
  let cache = defaultCacheRoot();
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--cache' && rest[i + 1]) cache = rest[++i];
    else if (!destination && !rest[i].startsWith('--')) destination = rest[i];
    else throw new Error(`unknown argument: ${rest[i]}`);
  }
  if (!destination) throw new Error('usage: toolkit download <destination> [--cache PATH]');
  const relativeCache = relative(root, resolve(cache));
  if (!relativeCache || (relativeCache !== '..' && !relativeCache.startsWith(`..${sep}`) && !isAbsolute(relativeCache))) {
    throw new Error('cache must be outside the repository');
  }
  const selected = artifacts.find(item => item.destination === destination);
  if (!selected) throw new Error(`unknown artifact: ${destination}`);
  const locked = lock[destination];
  if (!locked) throw new Error(`no lock entry for ${destination}; run check-updates --write-lock first`);
  const current = await resolveMetadata(selected.descriptor, fetcher);
  if (['filename', 'version', 'sha256', 'sizeBytes'].some(key => locked[key as keyof LockEntry] !== current[key as keyof ResolvedArtifact])) {
    throw new Error(`${destination} differs from the lock; run check-updates before downloading`);
  }
  current.downloadUrl ||= await resolveDownloadUrl(selected.descriptor, fetcher);
  const saved = await downloadToCache(destination, current, cache, fetcher, (received, total) => {
    output(`${(received / 1048576).toFixed(1)} MiB${total ? ` / ${(total / 1048576).toFixed(1)} MiB` : ''}`);
  });
  output(`${saved.reused ? 'Cached' : 'Downloaded'} ${destination}: ${saved.path} (${saved.verifiedAgainstUpstream ? 'expected SHA-256 verified' : 'local SHA-256 only; upstream integrity unverified'})`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
