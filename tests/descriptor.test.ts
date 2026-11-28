import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { discover } from '../src/descriptors.js';

test('discovers descriptors by destination without treating ordinary JSON as artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'toolkit-descriptors-'));
  try {
    await mkdir(join(root, 'ISO', 'Recovery'), { recursive: true });
    await writeFile(join(root, 'ISO', 'Recovery', 'Rescuezilla.iso.json'), JSON.stringify({
      name: 'Rescuezilla', source: { provider: 'manual', url: 'https://rescuezilla.com/download' },
    }));
    await writeFile(join(root, 'ventoy.json'), '{}');
    const found = await discover(root);
    assert.equal(found.length, 1);
    assert.equal(found[0].destination, 'ISO/Recovery/Rescuezilla.iso');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects invalid descriptors and symlinks before using their contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'toolkit-descriptors-'));
  try {
    await writeFile(join(root, 'Bad.iso.json'), JSON.stringify({ name: 'Bad', source: { provider: 'direct', url: 'file:///etc/passwd' } }));
    await assert.rejects(discover(root), /https URL/);
    await rm(join(root, 'Bad.iso.json'));
    await writeFile(join(root, 'Bad.iso.json'), JSON.stringify({ name: 'Bad', source: { provider: 'direct', url: 'https://example.org/Bad.iso', checksum: 'typo' } }));
    await assert.rejects(discover(root), /unknown source field/);
    await rm(join(root, 'Bad.iso.json'));
    await writeFile(join(root, 'Bad.iso.json'), JSON.stringify({ name: 'Bad', source: { provider: 'direct', url: 'https://user:password@example.org/Bad.iso' } }));
    await assert.rejects(discover(root), /credentials/);
    await rm(join(root, 'Bad.iso.json'));
    if (process.platform !== 'win32') {
      await symlink('/etc/passwd', join(root, 'Escaped.iso.json'));
      await assert.rejects(discover(root), /symlink/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects a symlinked drive root', { skip: process.platform === 'win32' }, async () => {
  const parent = await mkdtemp(join(tmpdir(), 'toolkit-root-'));
  try {
    await mkdir(join(parent, 'outside'));
    await symlink(join(parent, 'outside'), join(parent, 'drive'));
    await assert.rejects(discover(join(parent, 'drive')), /symlink/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});
