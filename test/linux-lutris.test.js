'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { contextForLutrisGame } = require('../src/core/lutris');
const { createSetupRunner } = require('../src/core/proton');
const { assertGameClosed } = require('../src/core/install-guards');
const { spawn } = require('child_process');

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-lutris-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dataHome = path.join(home, 'data');
  const prefix = path.join(home, 'Battle net');
  const dir = path.join(prefix, 'drive_c/Program Files/World of Warcraft/_retail_');
  const configs = path.join(dataHome, 'lutris/games');
  const command = path.join(dataHome, 'lutris/runtime/umu/umu-run');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(configs, { recursive: true });
  fs.mkdirSync(path.dirname(command), { recursive: true });
  fs.writeFileSync(command, '', { mode: 0o755 });
  fs.writeFileSync(path.join(prefix, 'system.reg'), '');
  fs.writeFileSync(path.join(configs, 'battlenet.yml'), `wine:\n  prefix: ${JSON.stringify(prefix)}\n  version: ge-proton\nsystem:\n  env:\n    TEST_SETTING: preserved\n`);
  return { home, dataHome, prefix, dir, configs, command, platform: 'linux' };
}

test('Lutris maps a nested WoW folder to existing GE-Proton prefix and UMU', t => {
  const f = fixture(t);
  const ctx = contextForLutrisGame(f.dir, f);
  assert.equal(ctx.prefix, f.prefix);
  assert.equal(ctx.command, f.command);
  assert.equal(ctx.env.PROTONPATH, 'GE-Proton');
  assert.equal(ctx.env.TEST_SETTING, 'preserved');
  assert.equal(contextForLutrisGame(f.home, f), null);
  const escape = path.join(f.dir, 'external');
  fs.symlinkSync(f.home, escape);
  assert.equal(contextForLutrisGame(escape, f), null);
});

test('missing and conflicting Lutris runners fail instead of selecting other Wine', t => {
  const f = fixture(t);
  fs.chmodSync(f.command, 0o644);
  assert.throws(() => contextForLutrisGame(f.dir, f), /not executable/);
  fs.chmodSync(f.command, 0o755);
  fs.writeFileSync(path.join(f.configs, 'other.yml'), `wine:\n  prefix: ${JSON.stringify(f.prefix)}\n  version: ge-proton\nsystem:\n  env:\n    GAMEID: other\n`);
  assert.throws(() => contextForLutrisGame(f.dir, f), /Multiple Lutris/);
});

test('setup runner preserves arguments with spaces and uses selected prefix', async t => {
  const f = fixture(t);
  const script = path.join(f.home, 'fake setup.js');
  fs.writeFileSync(script, 'console.log(JSON.stringify({args:process.argv.slice(2), prefix:process.env.WINEPREFIX, setting:process.env.TEST_SETTING}))');
  const ctx = { ...contextForLutrisGame(f.dir, f), command: process.execPath };
  const args = [path.join(f.dir, 'Wow.exe'), '--api', 'dxgi', '--headless'];
  const result = await createSetupRunner(ctx)(script, args, () => {});
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.output), { args, prefix: f.prefix, setting: 'preserved' });
});

test('Linux guard refuses a running Wine game even without Windows file locks', { skip: process.platform !== 'linux' }, async t => {
  const f = fixture(t);
  const child = spawn('/bin/bash', ['-c', 'exec -a SwapperTestGame.exe sleep 60']);
  t.after(() => child.kill());
  await new Promise(resolve => setTimeout(resolve, 100));
  await assert.rejects(assertGameClosed(f.dir, path.join(f.dir, 'SwapperTestGame.exe')), { code: 'errGameRunning' });
});
