import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compare, readLock, writeLock } from '../src/lock.js';

test('same-version checksum change is a refreshed image', () => {
  const old = { filename: 'tool-1.iso', version: '1', sha256: 'a'.repeat(64) };
  assert.equal(compare(old, { ...old, sha256: 'b'.repeat(64) }), 'refreshed-image');
  assert.equal(compare(old, old), 'up-to-date');
  assert.equal(compare(old, { ...old, version: '0' }), 'version-changed');
  assert.equal(compare({ filename: 'tool.iso', version: '1' }, { filename: 'tool.iso', version: '1' }), 'identity-unknown');
});

test('lock serialization is stable, ordered, and excludes URLs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'toolkit-lock-'));
  const path = join(root, 'toolkit.lock.json');
  try {
    await writeLock(path, { 'ISO/Z.iso': { filename: 'z.iso', version: '1' }, 'ISO/A.iso': { filename: 'a.iso', sha256: 'a'.repeat(64), downloadUrl: 'https://temporary.example/a' } });
    const first = await readFile(path, 'utf8');
    await writeLock(path, await readLock(path));
    assert.equal(await readFile(path, 'utf8'), first);
    assert.ok(first.indexOf('ISO/A.iso') < first.indexOf('ISO/Z.iso'));
    assert.doesNotMatch(first, /downloadUrl|temporary/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
