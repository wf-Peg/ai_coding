'use strict';

const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'frontend/js/editor.js');
const helpers = path.resolve(__dirname, '..', 'frontend/js/editor-lite-helpers.js');
let src = fs.readFileSync(file, 'utf-8');
const helperCode = fs.readFileSync(helpers, 'utf-8');

const marker = '})();';
const idx = src.lastIndexOf(marker);
if (idx === -1) throw new Error('IIFE close marker not found');

const out = src.slice(0, idx) + '\n' + helperCode + '\n' + src.slice(idx);
fs.writeFileSync(file, out, 'utf-8');
console.log('Inserted helpers at line', src.slice(0, idx).split('\n').length + 1);
