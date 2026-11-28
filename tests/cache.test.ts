import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { downloadToCache } from '../src/cache.js';

test('verified download is reused; failed replacement keeps the old artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'toolkit-cache-'));
  const bytes = Buffer.from('small fixture');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  let calls = 0;
  const progress: number[] = [];
  const fetcher: typeof fetch = async () => { calls++; return new Response(bytes); };
  try {
    const artifact = { filename: 'example.iso', sha256, sizeBytes: bytes.length, downloadUrl: 'https://example.org/example.iso' };
    const first = await downloadToCache('ISO/example.iso', artifact, root, fetcher, received => progress.push(received));
    assert.equal(await readFile(first.path, 'utf8'), 'small fixture');
    assert.equal(first.verifiedAgainstUpstream, true);
    assert.equal(progress.at(-1), bytes.length);
    const second = await downloadToCache('ISO/example.iso', artifact, root, fetcher);
    assert.equal(second.reused, true);
    assert.equal(calls, 1);
    await assert.rejects(downloadToCache('ISO/example.iso', { ...artifact, sha256: 'f'.repeat(64) }, root, fetcher), /checksum mismatch/);
    assert.equal(await readFile(first.path, 'utf8'), 'small fixture');
    await assert.rejects(downloadToCache('ISO/empty.iso', { filename: 'empty.iso', downloadUrl: 'https://example.org/empty.iso' }, root, async () => new Response('')), /empty download/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
