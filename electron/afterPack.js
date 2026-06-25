#!/usr/bin/env node

/**
 * afterPack hook for electron-builder
 * Validates the bundled JRE and fixes binary permissions inside the packaged macOS app.
 */
const fs = require('fs');
const path = require('path');

exports.default = async function(context) {
  if (context.packager.platform.name !== 'mac') {
    return;
  }

  const resourcesPath = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app', 'Contents', 'Resources');
  const jreBin = path.join(resourcesPath, 'jre', 'bin');
  
  if (!fs.existsSync(jreBin)) {
    console.log('[afterPack] No bundled JRE found, skipping permission fix');
    return;
  }

  const javaBinary = path.join(jreBin, 'java');
  if (!isMacExecutable(javaBinary)) {
    throw new Error(
      `[afterPack] Bundled JRE is not a macOS executable: ${javaBinary}\n` +
      'Use a macOS JRE/JDK for mac builds. The current jre/bin/java appears to be for another OS.'
    );
  }

  console.log('[afterPack] Fixing JRE permissions in:', jreBin);
  fixPermissionsRecursive(jreBin);
  console.log('[afterPack] JRE permissions fixed');
};

function isMacExecutable(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(4);
    fs.readSync(fd, header, 0, header.length, 0);
    const magic = header.readUInt32BE(0);
    return [
      0xfeedface,
      0xfeedfacf,
      0xcefaedfe,
      0xcffaedfe,
      0xcafebabe,
      0xbebafeca
    ].includes(magic);
  } finally {
    fs.closeSync(fd);
  }
}

function fixPermissionsRecursive(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        fixPermissionsRecursive(fullPath);
      } else if (entry.isFile() && !entry.name.endsWith('.jar')) {
        fs.chmodSync(fullPath, 0o755);
      }
    }
  } catch (e) {
    console.error('[afterPack] Failed to fix permissions in', dir, ':', e.message);
  }
}
