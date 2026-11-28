import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export type Source =
  | { provider: 'direct'; url: string; version?: string; sha256?: string; sizeBytes?: number }
  | { provider: 'github-release'; repository: string; release: string; assetPattern: string }
  | { provider: 'checksum-index'; baseUrl: string; checksumFile: string; assetPattern: string; release?: string }
  | { provider: 'manual'; url?: string };

export interface Descriptor {
  name: string;
  description?: string;
  source: Source;
  estimatedSizeBytes?: number;
  profiles?: string[];
  productUrl?: string;
  ventoy?: { alias?: string; class?: string; tip?: string };
}

export interface Artifact {
  destination: string;
  descriptor: Descriptor;
}

const artifactSuffix = /\.(iso|img|exe|zip|msi)\.json$/i;
const sha256 = /^[a-f\d]{64}$/i;
const validSegment = /^[^<>:"|?*\\/\x00-\x1f.][^<>:"|?*\\/\x00-\x1f]*$/;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected an object');
  return value as Record<string, unknown>;
}

function knownFields(value: Record<string, unknown>, allowed: string[], context: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`unknown ${context} field: ${key}`);
}

function nonempty(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function https(value: unknown, field: string): string {
  const text = nonempty(value, field);
  const url = new URL(text);
  if (url.protocol !== 'https:') throw new Error(`${field} must be an https URL`);
  if (url.username || url.password) throw new Error(`${field} must not contain credentials`);
  return text;
}

function positive(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`${field} must be a positive integer`);
  return value as number;
}

function pattern(value: unknown): string {
  const text = nonempty(value, 'assetPattern');
  try { new RegExp(text); } catch { throw new Error('assetPattern must be a valid regex'); }
  return text;
}

export function parseDescriptor(value: unknown): Descriptor {
  const raw = object(value);
  knownFields(raw, ['name', 'description', 'source', 'estimatedSizeBytes', 'profiles', 'productUrl', 'ventoy'], 'descriptor');
  const source = object(raw.source);
  const provider = nonempty(source.provider, 'source.provider');
  let parsedSource: Source;
  if (provider === 'direct') {
    knownFields(source, ['provider', 'url', 'version', 'sha256', 'sizeBytes'], 'source');
    parsedSource = { provider, url: https(source.url, 'source.url') };
    if (source.version !== undefined) parsedSource.version = nonempty(source.version, 'source.version');
    if (source.sha256 !== undefined) {
      if (typeof source.sha256 !== 'string' || !sha256.test(source.sha256)) throw new Error('source.sha256 must be 64 hex characters');
      parsedSource.sha256 = source.sha256.toLowerCase();
    }
    if (source.sizeBytes !== undefined) parsedSource.sizeBytes = positive(source.sizeBytes, 'source.sizeBytes');
  } else if (provider === 'github-release') {
    knownFields(source, ['provider', 'repository', 'release', 'assetPattern'], 'source');
    const repository = nonempty(source.repository, 'source.repository');
    if (!/^[A-Za-z\d_.-]+\/[A-Za-z\d_.-]+$/.test(repository)) throw new Error('source.repository must be owner/repo');
    parsedSource = { provider, repository, release: nonempty(source.release, 'source.release'), assetPattern: pattern(source.assetPattern) };
  } else if (provider === 'checksum-index') {
    knownFields(source, ['provider', 'baseUrl', 'checksumFile', 'assetPattern', 'release'], 'source');
    const checksumFile = nonempty(source.checksumFile, 'source.checksumFile');
    if (!validSegment.test(checksumFile) || checksumFile === '..') throw new Error('source.checksumFile must be a filename');
    parsedSource = { provider, baseUrl: https(source.baseUrl, 'source.baseUrl'), checksumFile, assetPattern: pattern(source.assetPattern) };
    if (source.release !== undefined) parsedSource.release = nonempty(source.release, 'source.release');
  } else if (provider === 'manual') {
    knownFields(source, ['provider', 'url'], 'source');
    parsedSource = { provider };
    if (source.url !== undefined) parsedSource.url = https(source.url, 'source.url');
  } else throw new Error(`unsupported provider: ${provider}`);

  const descriptor: Descriptor = { name: nonempty(raw.name, 'name'), source: parsedSource };
  if (raw.description !== undefined) descriptor.description = nonempty(raw.description, 'description');
  if (raw.productUrl !== undefined) descriptor.productUrl = https(raw.productUrl, 'productUrl');
  if (raw.estimatedSizeBytes !== undefined) descriptor.estimatedSizeBytes = positive(raw.estimatedSizeBytes, 'estimatedSizeBytes');
  if (raw.profiles !== undefined) {
    if (!Array.isArray(raw.profiles) || !raw.profiles.every(x => typeof x === 'string' && x.trim())) throw new Error('profiles must be non-empty strings');
    descriptor.profiles = raw.profiles;
  }
  if (raw.ventoy !== undefined) {
    const ventoy = object(raw.ventoy);
    knownFields(ventoy, ['alias', 'class', 'tip'], 'ventoy');
    descriptor.ventoy = {};
    for (const key of ['alias', 'class', 'tip'] as const) {
      if (ventoy[key] !== undefined) descriptor.ventoy[key] = nonempty(ventoy[key], `ventoy.${key}`);
    }
  }
  return descriptor;
}

export async function discover(driveRoot: string): Promise<Artifact[]> {
  const root = await lstat(driveRoot);
  if (root.isSymbolicLink()) throw new Error(`symlink is not allowed for drive root: ${driveRoot}`);
  if (!root.isDirectory()) throw new Error(`drive root is not a directory: ${driveRoot}`);
  const found: Artifact[] = [];
  const destinations = new Set<string>();
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`symlink is not allowed under drive/: ${join(directory, entry.name)}`);
      if (entry.isDirectory()) {
        if (entry.name !== 'downloads') await walk(join(directory, entry.name));
      } else if (entry.isFile() && artifactSuffix.test(entry.name)) {
        const path = join(directory, entry.name);
        const parts = relative(driveRoot, path).split(sep);
        if (parts.some(x => !validSegment.test(x) || x === '..' || /[. ]$/.test(x))) throw new Error(`invalid descriptor path: ${path}`);
        const destination = parts.join('/').slice(0, -5);
        const key = destination.toLowerCase();
        if (destinations.has(key)) throw new Error(`duplicate destination: ${destination}`);
        destinations.add(key);
        let descriptor: Descriptor;
        try { descriptor = parseDescriptor(JSON.parse(await readFile(path, 'utf8'))); }
        catch (error) { throw new Error(`${path}: ${String(error)}`); }
        found.push({ destination, descriptor });
      }
    }
  }
  await walk(driveRoot);
  return found.sort((a, b) => a.destination < b.destination ? -1 : a.destination > b.destination ? 1 : 0);
}
