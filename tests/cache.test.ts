import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { downloadToCache, importToCache } from '../src/cache.js';

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

test('local import verifies copied bytes and preserves a good cache on failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'toolkit-cache-'));
  const source = join(root, 'source.iso');
  const bytes = Buffer.from('local ISO fixture');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  try {
    await writeFile(source, bytes);
    const locked = { filename: 'upstream.iso', sha256, sizeBytes: bytes.length };
    const progress: number[] = [];
    const first = await importToCache('ISO/example.iso', source, locked, root, received => progress.push(received));
    assert.equal(first.reused, false);
    assert.equal(progress.at(-1), bytes.length);
    assert.equal(first.verifiedAgainstUpstream, true);
    assert.deepEqual(await readFile(first.path), bytes);
    const second = await importToCache('ISO/example.iso', source, locked, root);
    assert.equal(second.reused, true);
    await writeFile(source, 'wrong contents');
    await assert.rejects(importToCache('ISO/example.iso', source, locked, root), /size mismatch|checksum mismatch/);
    assert.deepEqual(await readFile(first.path), bytes);
    await assert.rejects(importToCache('ISO/example.iso', source, { filename: 'upstream.iso' }, root), /official SHA-256/);
    const link = join(root, 'link.iso');
    await symlink(source, link);
    await assert.rejects(importToCache('ISO/example.iso', link, locked, root), /regular file/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unverified cache identity includes source URL and rejects HTTP redirects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'toolkit-cache-'));
  let calls = 0;
  const fetcher: typeof fetch = async () => new Response(calls++ === 0 ? 'first' : 'other');
  try {
    const first = await downloadToCache('ISO/example.iso', { filename: 'example.iso', version: '1', sizeBytes: 5, downloadUrl: 'https://example.org/first' }, root, fetcher);
    assert.doesNotMatch(await readFile(join(root, 'index.json'), 'utf8'), /https:/);
    const second = await downloadToCache('ISO/example.iso', { filename: 'example.iso', version: '1', sizeBytes: 5, downloadUrl: 'https://example.org/other' }, root, fetcher);
    assert.equal(calls, 2);
    assert.notEqual(first.sha256, second.sha256);
    await assert.rejects(downloadToCache('ISO/redirect.iso', { filename: 'redirect.iso', downloadUrl: 'https://example.org/redirect' }, root, async () => new Response(null, { status: 302, headers: { location: 'http://insecure.example/redirect.iso' } })), /non-HTTPS redirect/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
