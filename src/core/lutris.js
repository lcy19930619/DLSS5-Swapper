'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const YAML = require('yaml');

// Read launcher configuration only. Never create a prefix or select an
// unrelated system Wine when the configured runner is missing.
function contextForLutrisGame(dir, options = {}) {
  if ((options.platform || process.platform) !== 'linux') return null;
  const home = options.home || os.homedir();
  const data = options.dataHome || process.env.XDG_DATA_HOME || path.join(home, '.local/share');
  const root = path.join(data, 'lutris');
  const configs = path.join(root, 'games');
  const expand = value => typeof value === 'string' ? value.replace(/^~(?=\/)/, home) : '';
  let names;
  try { names = fs.readdirSync(configs); } catch { return null; }
  const realDir = fs.realpathSync(dir);
  const matches = [];
  for (const name of names.filter(n => /\.ya?ml$/.test(n))) {
    let config, prefix;
    try {
      config = YAML.parse(fs.readFileSync(path.join(configs, name), 'utf8'));
      prefix = fs.realpathSync(expand(config?.wine?.prefix));
      const drive = fs.realpathSync(path.join(prefix, 'drive_c'));
      const relative = path.relative(drive, realDir);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) continue;
      if (!fs.existsSync(path.join(prefix, 'system.reg'))) continue;
    } catch { continue; }
    const wine = config.wine;
    const env = Object.fromEntries(Object.entries(config.system?.env || {})
      .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
      .map(([k, v]) => [k, String(v)]));
    let command;
    if (wine.version === 'ge-proton') {
      command = [path.join(root, 'runtime/umu/umu-run'), '/usr/bin/umu-run']
        .find(file => fs.existsSync(file));
      env.PROTONPATH ||= 'GE-Proton';
      env.GAMEID ||= 'umu-default';
      env.WINEARCH ||= 'win64';
    } else if (wine.version === 'custom') {
      command = expand(wine.custom_wine_path);
      if (/proton/i.test(command)) throw new Error('Lutris: custom Proton runners require UMU configuration.');
    } else if (wine.version === 'system') {
      command = '/usr/bin/wine';
    } else if (typeof wine.version === 'string' && /^[\w.+-]+$/.test(wine.version) && !/proton/i.test(wine.version)) {
      command = path.join(root, 'runners/wine', wine.version, 'bin/wine');
    }
    if (!command || !path.isAbsolute(command)) throw new Error(`Lutris runner unavailable: ${wine.version}`);
    try { fs.accessSync(command, fs.constants.X_OK); }
    catch { throw new Error(`Lutris runner not executable: ${command}`); }
    matches.push({ command, prefix, env, launcher: 'Lutris', config: path.join(configs, name) });
  }
  if (matches.length > 1 && matches.some(m => m.prefix !== matches[0].prefix || m.command !== matches[0].command || JSON.stringify(m.env) !== JSON.stringify(matches[0].env))) {
    throw new Error('Multiple Lutris configurations match this game with different runners or environments.');
  }
  return matches[0] || null;
}

module.exports = { contextForLutrisGame };
