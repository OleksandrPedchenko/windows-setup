import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMetadata } from '../src/providers.js';
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
