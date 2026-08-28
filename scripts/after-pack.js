'use strict';

const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  const arch = context.arch === 3 ? 'arm64' : context.arch === 1 ? 'x64' : '';
  if (!arch) throw new Error(`GrowBar has no native Bluetooth helper for electron-builder architecture ${context.arch}.`);
  const source = path.join(context.packager.projectDir, 'native', 'bin', arch, 'GrowBarBluetoothBridge');
  const destination = path.join(
    context.appOutDir,
    'GrowBar.app', 'Contents', 'Resources', 'native',
    'GrowBarBluetoothBridge.app', 'Contents', 'MacOS', 'GrowBarBluetoothBridge'
  );
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, 0o755);
};
