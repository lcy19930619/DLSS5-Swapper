'use strict';
// Explicit, reversible deployment of the PR #435 proxy used in the WoW test.
// The DLL must be obtained separately; no third-party binary is bundled here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { assertGameClosed } = require('../src/core/install-guards');
const journal = require('../src/core/file-journal');
const { copyTracked, saveActiveManifest } = require('../src/core/apply');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const expected = '2f035e5dde2a483d3123abab4944b400e5c56969a6f77f8396c9617d29fe537d';

async function install(gameDir, dll) {
  assert.equal(process.platform, 'linux', 'This helper is for the documented Linux experiment');
  const game = fs.realpathSync(gameDir);
  assert.equal(sha(dll), expected, 'Not the verified PR #435 proxy build');
  const manifestPath = journal.safePath(game, '_DLSS5_Backup/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.route, 'renodx', 'Select the multipass route first');
  const exe = journal.safePath(game, manifest.game.exe);
  assert.equal(path.dirname(exe), game, 'Select the directory containing the game executable');
  await assertGameClosed(game, exe);
  assert(manifest.added.includes('dxgi.dll') || manifest.replaced.some(item => item.rel === 'dxgi.dll'), 'Existing tracked ReShade required');
  for (const name of ['dlss5-feed.addon64', 'renodx-dlss5.addon64', 'dlssnr-linux.addon64']) {
    assert(!fs.existsSync(path.join(game, name)), `Conflicting add-on: ${name}`);
  }
  const unchanged = [manifest.game.exe, 'renodx-dlss.addon64', 'nvngx_dlss.dll', 'nvngx_dlssnr.dll', 'ReShade.ini'];
  const hashes = unchanged.map(rel => sha(journal.safePath(game, rel)));
  const target = journal.safePath(game, 'dxgi.dll');
  const backupRoot = journal.safePath(game, '_DLSS5_Backup');
  const backup = fs.mkdtempSync(path.join(backupRoot, 'linux-proxy-before-'));
  for (const rel of ['dxgi.dll', 'ReShade.ini', 'ReShade.log', '_DLSS5_Backup/manifest.json']) {
    const src = journal.safePath(game, rel);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(backup, path.basename(rel)), fs.constants.COPYFILE_FICLONE);
  }
  await assertGameClosed(game, exe);
  await journal.transaction(game, async () => {
    await copyTracked(manifest, game, dll, target, { kind: 'linux-reshade-proxy' });
    manifest.linuxReShadeProxy = {
      source: 'https://github.com/crosire/reshade/pull/435',
      attachment: 'https://github.com/user-attachments/files/32090311/ReShade64.zip',
      sha256: expected, backup: path.relative(game, backup), date: new Date().toISOString()
    };
    await saveActiveManifest(game, manifest);
    assert.equal(sha(target), expected);
    unchanged.forEach((rel, i) => assert.equal(sha(journal.safePath(game, rel)), hashes[i], rel));
  });
  console.log(JSON.stringify({ backup, sha256: expected, unchanged, runtimeVerified: false }, null, 2));
}

if (require.main === module) {
  if (process.argv.length !== 4) {
    console.error('Usage: node scripts/install-linux-reshade-proxy.cjs GAME_DIRECTORY VERIFIED_ReShade64.dll');
    process.exitCode = 1;
  } else install(process.argv[2], path.resolve(process.argv[3])).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = { install };
