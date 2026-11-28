import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMetadata, resolveDownloadUrl } from '../src/providers.js';
import type { Descriptor } from '../src/descriptors.js';

const descriptor = (source: Descriptor['source']): Descriptor => ({ name: 'Example', source });
const respond = (body: unknown): typeof fetch => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body));

test('checksum index chooses latest matching version and official hash', async () => {
  const source = descriptor({ provider: 'checksum-index', baseUrl: 'https://example.org/iso/', checksumFile: 'SHA256SUMS', assetPattern: '^tool_(\\d+\\.\\d+-\\d+)\\.iso$' });
  const text = `${'a'.repeat(64)}  tool_9.2-1.iso\n${'b'.repeat(64)}  tool_9.10-1.iso\n`;
  assert.deepEqual(await resolveMetadata(source, respond(text)), {
    filename: 'tool_9.10-1.iso', version: '9.10-1', sha256: 'b'.repeat(64), downloadUrl: 'https://example.org/iso/tool_9.10-1.iso',
  });
});

test('GitHub release rejects ambiguous ISO asset matches', async () => {
  const source = descriptor({ provider: 'github-release', repository: 'example/tool', release: 'latest', assetPattern: '^tool.*\\.iso$' });
  await assert.rejects(resolveMetadata(source, respond({ tag_name: 'v1', assets: [
    { name: 'tool-a.iso', browser_download_url: 'https://example.org/a', digest: `sha256:${'a'.repeat(64)}`, size: 10 },
    { name: 'tool-b.iso', browser_download_url: 'https://example.org/b', digest: `sha256:${'b'.repeat(64)}`, size: 10 },
  ] })), /multiple assets/);
});

test('manual source requires manual action', async () => {
  await assert.rejects(resolveMetadata(descriptor({ provider: 'manual', url: 'https://example.org' }), respond('')), /manual/);
});

test('direct source resolves declared checksum without a metadata request', async () => {
  const source = descriptor({ provider: 'direct', url: 'https://example.org/releases/tool.iso', version: '1', sha256: 'c'.repeat(64) });
  assert.deepEqual(await resolveMetadata(source, async () => { throw new Error('unexpected network request'); }), {
    filename: 'tool.iso', version: '1', sha256: 'c'.repeat(64), downloadUrl: 'https://example.org/releases/tool.iso',
  });
});

test('metadata resolution rejects an HTTPS to HTTP redirect', async () => {
  const source = descriptor({ provider: 'github-release', repository: 'example/tool', release: 'latest', assetPattern: '\\.iso$' });
  let calls = 0;
  await assert.rejects(resolveMetadata(source, async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: 'http://insecure.example/release' } });
  }), /non-HTTPS redirect/);
  assert.equal(calls, 1);
});

test('metadata resolution follows an HTTPS redirect', async () => {
  const source = descriptor({ provider: 'github-release', repository: 'example/tool', release: 'latest', assetPattern: '^tool\\.iso$' });
  const urls: string[] = [];
  const result = await resolveMetadata(source, async input => {
    urls.push(String(input));
    if (urls.length === 1) return new Response(null, { status: 302, headers: { location: 'https://api.github.com/repos/example/tool/releases/tags/v1' } });
    return new Response(JSON.stringify({ tag_name: 'v1', assets: [{ name: 'tool.iso', browser_download_url: 'https://example.org/tool.iso', digest: `sha256:${'a'.repeat(64)}`, size: 10 }] }));
  });
  assert.equal(urls.length, 2);
  assert.equal(result.version, 'v1');
});

test('Microsoft metadata uses the current official English x64 checksum without requesting a link', async () => {
  const page = `<p>(Current release: Windows 11 2026 Update l Version 26H2)</p><select id="product-edition"><option value="3813">Windows 11 (multi-edition ISO for x64 devices)</option></select><tr><td>English 64-bit</td><td>${'a'.repeat(64)}</td></tr>`;
  const urls: string[] = [];
  const result = await resolveMetadata(descriptor({ provider: 'microsoft', product: 'windows11', language: 'en-US', architecture: 'x64' }), async input => {
    urls.push(String(input));
    return new Response(page);
  });
  assert.deepEqual(urls, ['https://www.microsoft.com/en-us/software-download/windows11']);
  assert.deepEqual(result, { filename: 'Windows11-English-x64.iso', version: '26H2', sha256: 'a'.repeat(64) });
});

test('Microsoft Windows 10 metadata reads its release heading', async () => {
  const page = `<h2>Windows 10 2023 Update | Version 22H2</h2><tr><td>English 64-bit</td><td>${'b'.repeat(64)}</td></tr>`;
  assert.deepEqual(await resolveMetadata(descriptor({ provider: 'microsoft', product: 'windows10', language: 'en-US', architecture: 'x64' }), respond(page)), {
    filename: 'Windows10-English-x64.iso', version: '22H2', sha256: 'b'.repeat(64),
  });
});

test('Microsoft link resolution rejects Sentinel errors with manual fallback', async () => {
  const source = descriptor({ provider: 'microsoft', product: 'windows11', language: 'en-US', architecture: 'x64' });
  const fetcher: typeof fetch = async input => {
    const url = String(input);
    if (url.includes('windows11')) return new Response('<option value="3813">Windows 11 (multi-edition ISO for x64 devices)</option>');
    if (url.includes('vlscppe.microsoft.com/tags')) return new Response('registered');
    if (url.includes('/mdt.js')) return new Response('window.dfp={url:"https://ov-df.microsoft.com/?w=ABC123"};src+="&rticks="+123456;');
    if (url.startsWith('https://ov-df.microsoft.com/?')) return new Response('registered');
    if (url.includes('getskuinformation')) return new Response(JSON.stringify({ Skus: [{ Id: '27160', Language: 'English' }] }));
    return new Response(JSON.stringify({ Errors: [{ Key: 'ErrorSettings.SentinelReject' }] }));
  };
  await assert.rejects(resolveDownloadUrl(source, fetcher), /Microsoft blocked automatic link generation.*microsoft.com/);
});

test('Microsoft link resolution accepts only official x64 ISO URL', async () => {
  const source = descriptor({ provider: 'microsoft', product: 'windows10', language: 'en-US', architecture: 'x64' });
  const requests: string[] = [];
  const fetcher: typeof fetch = async input => {
    const url = String(input);
    requests.push(url);
    if (url.includes('windows10ISO')) return new Response('<option value="2618">Windows 10 (multi-edition ISO)</option>');
    if (url.includes('vlscppe.microsoft.com/tags')) return new Response('registered');
    if (url.includes('/mdt.js')) return new Response('window.dfp={url:"https://ov-df.microsoft.com/?w=ABC123"};src+="&rticks="+123456;');
    if (url.startsWith('https://ov-df.microsoft.com/?')) return new Response('registered');
    if (url.includes('getskuinformation')) return new Response(JSON.stringify({ Skus: [{ Id: '16067', Language: 'English' }] }));
    return new Response(JSON.stringify({ ProductDownloadOptions: [{ DownloadType: 1, Uri: 'https://software.download.prss.microsoft.com/db/Win10_22H2_English_x64.iso?token=short' }] }));
  };
  assert.match(await resolveDownloadUrl(source, fetcher), /Win10_22H2_English_x64\.iso/);
  assert.equal(requests.length, 6);
  assert.match(requests[3], /rticks=123456/);
  const hostile: typeof fetch = async input => {
    const url = String(input);
    if (url.includes('windows10ISO')) return new Response('<option value="2618">Windows 10 (multi-edition ISO)</option>');
    if (url.includes('vlscppe.microsoft.com/tags')) return new Response('registered');
    if (url.includes('/mdt.js')) return new Response('window.dfp={url:"https://ov-df.microsoft.com/?w=ABC123"};src+="&rticks="+123456;');
    if (url.startsWith('https://ov-df.microsoft.com/?')) return new Response('registered');
    if (url.includes('getskuinformation')) return new Response(JSON.stringify({ Skus: [{ Id: '16067', Language: 'English' }] }));
    return new Response(JSON.stringify({ ProductDownloadOptions: [{ DownloadType: 1, Uri: 'https://microsoft.com.evil.example/Win10.iso' }] }));
  };
  await assert.rejects(resolveDownloadUrl(source, hostile), /untrusted Microsoft download URL/);
});
