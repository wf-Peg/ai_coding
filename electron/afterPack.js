#!/usr/bin/env node

/**
 * afterPack hook for electron-builder
 * Fixes JRE binary permissions inside the packaged macOS app
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

  console.log('[afterPack] Fixing JRE permissions in:', jreBin);
  fixPermissionsRecursive(jreBin);
  console.log('[afterPack] JRE permissions fixed');
};

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