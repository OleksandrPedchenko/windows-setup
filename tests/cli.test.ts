import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { main } from '../src/cli.js';
import { readLock, writeLock } from '../src/lock.js';

test('provider outage reports failure and preserves its locked entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'toolkit-cli-'));
  const destination = 'ISO/Recovery/Example.iso';
  const old = { filename: 'example-1.iso', version: '1', sha256: 'a'.repeat(64) };
  try {
    await mkdir(join(root, 'drive', 'ISO', 'Recovery'), { recursive: true });
    await writeFile(join(root, 'drive', `${destination}.json`), JSON.stringify({ name: 'Example', source: { provider: 'github-release', repository: 'example/example', release: 'latest', assetPattern: '^example.*\\.iso$' } }));
    await writeLock(join(root, 'toolkit.lock.json'), { [destination]: old });
    const lines: string[] = [];
    const status = await main(['check-updates', '--write-lock'], { root, output: line => lines.push(line), fetcher: async () => new Response('unavailable', { status: 503 }) });
    assert.equal(status, 1);
    assert.deepEqual((await readLock(join(root, 'toolkit.lock.json')))[destination], old);
    assert.match(lines.join('\n'), /source-unavailable/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('update check is read-only by default', async () => {
  const root = await mkdtemp(join(tmpdir(), 'toolkit-cli-'));
  try {
    await mkdir(join(root, 'drive', 'ISO'), { recursive: true });
    await writeFile(join(root, 'drive', 'ISO', 'Example.iso.json'), JSON.stringify({ name: 'Example', source: { provider: 'direct', url: 'https://example.org/Example.iso', version: '1' } }));
    assert.equal(await main(['check-updates'], { root, output: () => {} }), 0);
    await assert.rejects(access(join(root, 'toolkit.lock.json')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('human update reports show changed checksum and size', async () => {
  const root = await mkdtemp(join(tmpdir(), 'toolkit-cli-'));
  const destination = 'ISO/Example.iso';
  try {
    await mkdir(join(root, 'drive', 'ISO'), { recursive: true });
    await writeFile(join(root, 'drive', `${destination}.json`), JSON.stringify({ name: 'Example', source: { provider: 'direct', url: 'https://example.org/Example.iso', version: '1', sha256: 'b'.repeat(64), sizeBytes: 20 } }));
    await writeLock(join(root, 'toolkit.lock.json'), { [destination]: { filename: 'Example.iso', version: '1', sha256: 'a'.repeat(64), sizeBytes: 10 } });
    for (const args of [['check-updates'], ['check-updates', '--report', 'markdown']]) {
      const lines: string[] = [];
      assert.equal(await main(args, { root, output: line => lines.push(line) }), 0);
      const report = lines.join('\n');
      assert.match(report, /refreshed-image/);
      assert.match(report, /a{64}/);
      assert.match(report, /b{64}/);
      assert.match(report, /10/);
      assert.match(report, /20/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('locked direct artifact downloads to cache without writing into drive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'toolkit-cli-'));
  const cache = await mkdtemp(join(tmpdir(), 'toolkit-cache-'));
  const destination = 'ISO/Example.iso';
  const bytes = Buffer.from('fixture ISO');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  try {
    await mkdir(join(root, 'drive', 'ISO'), { recursive: true });
    await writeFile(join(root, 'drive', `${destination}.json`), JSON.stringify({ name: 'Example', source: { provider: 'direct', url: 'https://example.org/Example.iso', version: '1', sha256, sizeBytes: bytes.length } }));
    await writeLock(join(root, 'toolkit.lock.json'), { [destination]: { filename: 'Example.iso', version: '1', sha256, sizeBytes: bytes.length } });
    const lines: string[] = [];
    await assert.rejects(main(['download', destination, '--cache', join(root, 'cache')], { root, fetcher: async () => new Response(bytes) }), /outside the repository/);
    const status = await main(['download', destination, '--cache', cache], { root, output: line => lines.push(line), fetcher: async () => new Response(bytes) });
    assert.equal(status, 0);
    assert.match(lines.join('\n'), /expected SHA-256 verified/);
    await assert.rejects(access(join(root, 'drive', destination)));
    await writeFile(join(root, 'drive', `${destination}.json`), JSON.stringify({ name: 'Example', source: { provider: 'direct', url: 'https://example.org/Example.iso', version: '2', sha256, sizeBytes: bytes.length } }));
    await assert.rejects(main(['download', destination, '--cache', cache], { root, fetcher: async () => new Response(bytes) }), /differs from the lock/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('import uses the locked checksum without a network request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'toolkit-cli-'));
  const cache = await mkdtemp(join(tmpdir(), 'toolkit-cache-'));
  const source = join(root, 'local.iso');
  const destination = 'ISO/Windows/Windows11.iso';
  const bytes = Buffer.from('local Windows ISO fixture');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  try {
    await mkdir(join(root, 'drive', 'ISO', 'Windows'), { recursive: true });
    await writeFile(join(root, 'drive', `${destination}.json`), JSON.stringify({ name: 'Windows 11', source: { provider: 'manual' } }));
    await writeFile(source, bytes);
    await writeLock(join(root, 'toolkit.lock.json'), { [destination]: { filename: 'Windows11.iso', sha256, sizeBytes: bytes.length } });
    const lines: string[] = [];
    await assert.rejects(main(['import', destination, source, '--cache', join(root, 'cache')], { root }), /outside the repository/);
    const linkedCache = join(cache, 'linked-cache');
    await symlink(root, linkedCache, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(main(['import', destination, source, '--cache', linkedCache], { root }), /outside the repository/);
    await assert.rejects(access(join(root, 'artifacts')));
    const linkedArtifacts = join(cache, 'artifacts');
    await symlink(root, linkedArtifacts, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(main(['import', destination, source, '--cache', cache], { root }), /outside the repository/);
    await rm(linkedArtifacts);
    assert.equal(await main(['import', destination, source, '--cache', cache], { root, output: line => lines.push(line), fetcher: async () => { throw new Error('network used'); } }), 0);
    assert.match(lines.join('\n'), /expected SHA-256 verified/);
    await assert.rejects(access(join(root, 'drive', destination)));
    await writeLock(join(root, 'toolkit.lock.json'), {});
    await assert.rejects(main(['import', destination, source, '--cache', cache], { root }), /no lock entry/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});
