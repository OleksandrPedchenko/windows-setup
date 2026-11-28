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
