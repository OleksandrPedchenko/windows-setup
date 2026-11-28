import type { Descriptor } from './descriptors.js';

export interface ResolvedArtifact {
  filename: string;
  version?: string;
  sha256?: string;
  sizeBytes?: number;
  downloadUrl?: string;
}

export class ManualSourceError extends Error {}

const filenamePattern = /^[^<>:"|?*\\/\x00-\x1f.][^<>:"|?*\\/\x00-\x1f]*$/;

function safeFilename(name: string): string {
  if (!filenamePattern.test(name) || name === '..' || /[. ]$/.test(name)) throw new Error(`unsafe upstream filename: ${name}`);
  return name;
}

function httpsUrl(value: unknown): string {
  if (typeof value !== 'string' || new URL(value).protocol !== 'https:') throw new Error('provider returned a non-HTTPS URL');
  return value;
}

async function request(url: string, fetcher: typeof fetch): Promise<Response> {
  const response = await fetcher(url, { headers: { 'User-Agent': 'ventoy-toolkit', Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`upstream HTTP ${response.status}: ${new URL(url).host}`);
  return response;
}

export async function resolveMetadata(descriptor: Descriptor, fetcher: typeof fetch = fetch): Promise<ResolvedArtifact> {
  const source = descriptor.source;
  if (source.provider === 'manual') throw new ManualSourceError(`${descriptor.name} requires manual download`);
  if (source.provider === 'direct') {
    const url = httpsUrl(source.url);
    return {
      filename: safeFilename(decodeURIComponent(new URL(url).pathname.split('/').pop() || '')),
      ...(source.version && { version: source.version }),
      ...(source.sha256 && { sha256: source.sha256 }),
      ...(source.sizeBytes && { sizeBytes: source.sizeBytes }),
      downloadUrl: url,
    };
  }
  if (source.provider === 'github-release') {
    const endpoint = source.release === 'latest' ? 'latest' : `tags/${encodeURIComponent(source.release)}`;
    const url = `https://api.github.com/repos/${source.repository}/releases/${endpoint}`;
    const release = await (await request(url, fetcher)).json() as { tag_name?: string; assets?: Array<{ name: string; browser_download_url: string; digest?: string; size?: number }> };
    const regex = new RegExp(source.assetPattern);
    const matches = (release.assets || []).filter(asset => regex.test(asset.name));
    if (matches.length !== 1) throw new Error(`${source.repository}: expected one asset, found ${matches.length}${matches.length > 1 ? ' (multiple assets)' : ''}`);
    const asset = matches[0];
    const digest = /^sha256:([a-f\d]{64})$/i.exec(asset.digest || '');
    return {
      filename: safeFilename(asset.name),
      ...(release.tag_name && { version: release.tag_name }),
      ...(digest && { sha256: digest[1].toLowerCase() }),
      ...(Number.isSafeInteger(asset.size) && asset.size! > 0 && { sizeBytes: asset.size }),
      downloadUrl: httpsUrl(asset.browser_download_url),
    };
  }
  const base = source.baseUrl.endsWith('/') ? source.baseUrl : `${source.baseUrl}/`;
  const indexUrl = new URL(source.checksumFile, base).href;
  const index = await (await request(indexUrl, fetcher)).text();
  const regex = new RegExp(source.assetPattern);
  const candidates: Array<{ filename: string; version?: string; sha256: string }> = [];
  for (const line of index.split(/\r?\n/)) {
    const match = /^([a-f\d]{64})\s+\*?(.+)$/.exec(line);
    if (!match) continue;
    const filename = match[2].trim();
    const assetMatch = regex.exec(filename);
    if (assetMatch && (!source.release || source.release === 'latest' || assetMatch[1] === source.release)) {
      candidates.push({ filename: safeFilename(filename), ...(assetMatch[1] && { version: assetMatch[1] }), sha256: match[1].toLowerCase() });
    }
  }
  if (!candidates.length) throw new Error(`no matching asset in ${indexUrl}`);
  candidates.sort((a, b) => new Intl.Collator('en', { numeric: true }).compare(a.version || a.filename, b.version || b.filename));
  const selected = candidates.at(-1)!;
  if (candidates.length > 1 && (candidates.at(-2)!.version || candidates.at(-2)!.filename) === (selected.version || selected.filename)) {
    throw new Error(`multiple assets share release ${selected.version || selected.filename}`);
  }
  return { ...selected, downloadUrl: new URL(encodeURIComponent(selected.filename), base).href };
}
