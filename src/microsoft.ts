import { randomUUID } from 'node:crypto';
import type { Descriptor } from './descriptors.js';
import { fetchHttps, type ResolvedArtifact } from './providers.js';

type MicrosoftSource = Extract<Descriptor['source'], { provider: 'microsoft' }>;

const pageUrl = (source: MicrosoftSource): string => `https://www.microsoft.com/en-us/software-download/${source.product === 'windows11' ? 'windows11' : 'windows10ISO'}`;
const productName = (source: MicrosoftSource): string => source.product === 'windows11' ? 'Windows 11' : 'Windows 10';
const browserHeaders = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };

async function officialPage(source: MicrosoftSource, fetcher: typeof fetch): Promise<{ html: string; cookies: string }> {
  const url = pageUrl(source);
  const response = await fetchHttps(url, fetcher, { headers: browserHeaders });
  if (!response.ok) throw new Error(`Microsoft page HTTP ${response.status}: ${url}`);
  const cookies = response.headers.getSetCookie().map(cookie => cookie.split(';', 1)[0]).join('; ');
  return { html: await response.text(), cookies };
}

export async function microsoftMetadata(source: MicrosoftSource, fetcher: typeof fetch): Promise<ResolvedArtifact> {
  const { html } = await officialPage(source, fetcher);
  const name = productName(source);
  const release = new RegExp(`${name}[^<]{0,100}Version\\s+(\\d{2}H[12])`, 'i').exec(html);
  const checksum = /<td[^>]*>\s*English 64-bit\s*<\/td>\s*<td[^>]*>\s*([a-f\d]{64})\s*<\/td>/i.exec(html);
  if (!release || !checksum) throw new Error(`Microsoft ${name} release or English x64 SHA-256 is unavailable at ${pageUrl(source)}`);
  return { filename: `${source.product === 'windows11' ? 'Windows11' : 'Windows10'}-English-x64.iso`, version: release[1], sha256: checksum[1].toLowerCase() };
}

export async function microsoftDownloadUrl(source: MicrosoftSource, fetcher: typeof fetch): Promise<string> {
  const page = pageUrl(source);
  const { html, cookies } = await officialPage(source, fetcher);
  const edition = [...html.matchAll(/<option\s+value="(\d+)"[^>]*>([^<]*Windows[^<]*)<\/option>/gi)]
    .find(match => match[2].includes(productName(source)) && (source.product === 'windows10' || /x64/i.test(match[2])))?.[1];
  if (!edition) throw new Error(`Microsoft edition selection changed: ${page}`);
  const editionId = edition;
  const session = randomUUID();
  const headers = { ...browserHeaders, Referer: page, Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest', ...(cookies && { Cookie: cookies }) };
  const api = 'https://www.microsoft.com/software-download-connector/api/';
  async function call(action: string, sku: string): Promise<Record<string, unknown>> {
    const query = new URLSearchParams({ profile: '606624d44113', ProductEditionId: action === 'getskuinformationbyproductedition' ? editionId : 'undefined', SKU: sku, friendlyFileName: 'undefined', Locale: 'en-us', sessionID: session });
    const response = await fetchHttps(`${api}${action}?${query}`, fetcher, { headers });
    if (!response.ok) throw new Error(`Microsoft download service HTTP ${response.status}; use ${page} to download manually`);
    const value = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Microsoft download service returned an invalid response; use ${page} to download manually`);
    return value as Record<string, unknown>;
  }
  const skus = (await call('getskuinformationbyproductedition', 'undefined')).Skus;
  const sku = Array.isArray(skus) ? skus.find(item => item?.Language === 'English')?.Id : undefined;
  if (typeof sku !== 'string') throw new Error(`Microsoft English x64 edition is unavailable; use ${page} to download manually`);
  const links = await call('GetProductDownloadLinksBySku', sku);
  if (Array.isArray(links.Errors) && links.Errors.length) throw new Error(`Microsoft blocked automatic link generation; use ${page} to download manually`);
  const options = links.ProductDownloadOptions;
  const link = Array.isArray(options) ? options.find(item => item?.DownloadType === '64-bit')?.Uri : undefined;
  if (typeof link !== 'string') throw new Error(`Microsoft x64 link is unavailable; use ${page} to download manually`);
  const url = new URL(link);
  if (url.protocol !== 'https:' || url.username || url.password || !/^(?:[a-z\d-]+\.)*microsoft\.com$/i.test(url.hostname) || !/\.iso$/i.test(url.pathname)) {
    throw new Error('untrusted Microsoft download URL');
  }
  return link;
}
