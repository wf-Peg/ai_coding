#!/usr/bin/env node
/**
 * test-build.js — 构建配置验证脚本
 * 
 * 在打包前运行，验证：
 * 1. package.json 配置正确性
 * 2. 必要文件存在性
 * 3. 构建脚本语法正确性
 * 4. JRE 目录结构
 * 
 * 用法：node scripts/test-build.js
 * 退出码：0 = 通过，1 = 失败
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_DIR = path.join(__dirname, '..');
let errors = [];
let warnings = [];
let passed = 0;
let total = 0;

function check(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    errors.push(`${name}: ${e.message}`);
    console.log(`  ✗ ${name}: ${e.message}`);
  }
}

function warn(name, msg) {
  warnings.push(`${name}: ${msg}`);
  console.log(`  ⚠ ${name}: ${msg}`);
}

console.log('\n=== 构建配置验证 ===\n');
console.log('1. 项目文件检查');

// package.json
check('package.json 存在', () => {
  if (!fs.existsSync(path.join(PROJECT_DIR, 'package.json'))) {
    throw new Error('文件不存在');
  }
});

check('package.json 可解析', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, 'package.json'), 'utf-8'));
  if (!pkg.version) throw new Error('缺少 version 字段');
  if (!pkg.name) throw new Error('缺少 name 字段');
  if (!pkg.main) throw new Error('缺少 main 字段');
  if (!pkg.build) throw new Error('缺少 build 配置');
});

const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, 'package.json'), 'utf-8'));

check('版本号格式正确', () => {
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    throw new Error(`版本号格式不正确: ${pkg.version}`);
  }
});

// 构建配置
check('win.target 包含 portable', () => {
  const targets = pkg.build.win.target.map(t => t.target || t);
  if (!targets.includes('portable')) {
    throw new Error('Windows 缺少 portable 目标');
  }
});

check('mac.target 包含 zip', () => {
  const targets = pkg.build.mac.target.map(t => t.target || t);
  if (!targets.includes('zip')) {
    throw new Error('macOS 缺少 zip 目标');
  }
});

check('extraResources 配置正确', () => {
  const resources = pkg.build.extraResources || [];
  const hasBackend = resources.some(r => r.to && r.to.includes('backend'));
  const hasFrontend = resources.some(r => r.to && r.to.includes('frontend'));
  if (!hasBackend) throw new Error('缺少 backend extraResources');
  if (!hasFrontend) throw new Error('缺少 frontend extraResources');
});

// 构建脚本
check('scripts 包含 build:portable:win', () => {
  if (!pkg.scripts['build:portable:win']) throw new Error('缺少 build:portable:win');
});

check('scripts 包含 build:portable:mac-arm', () => {
  if (!pkg.scripts['build:portable:mac-arm']) throw new Error('缺少 build:portable:mac-arm');
});

check('scripts 包含 download-jre', () => {
  if (!pkg.scripts['download-jre']) throw new Error('缺少 download-jre');
});

check('scripts 包含 release', () => {
  if (!pkg.scripts['release']) throw new Error('缺少 release');
});

check('scripts 包含 download-jre:win', () => {
  if (!pkg.scripts['download-jre:win']) throw new Error('缺少 download-jre:win');
});

check('scripts 包含 release:win', () => {
  if (!pkg.scripts['release:win']) throw new Error('缺少 release:win');
});

console.log('\n2. 关键文件检查');

const requiredFiles = [
  'electron/main.js',
  'electron/preload.js',
  'electron/update-manager.js',
  'electron/afterPack.js',
  'scripts/release.sh',
  'scripts/release.bat',
  'scripts/download-jre.sh',
  'scripts/download-jre.bat',
  'scripts/prebuild-clean.js',
  'frontend/index.html',
  'frontend/clip.html',
  'frontend/settings.html',
  'frontend/settings.js',
  'backend/pom.xml',
];

for (const file of requiredFiles) {
  check(`文件存在: ${file}`, () => {
    if (!fs.existsSync(path.join(PROJECT_DIR, file))) {
      throw new Error('文件不存在');
    }
  });
}

console.log('\n3. 脚本语法检查');

check('release.sh 语法正确', () => {
  try {
    execSync('bash -n scripts/release.sh', { cwd: PROJECT_DIR, stdio: 'pipe' });
  } catch (e) {
    throw new Error('脚本语法错误');
  }
});

check('download-jre.sh 语法正确', () => {
  try {
    execSync('bash -n scripts/download-jre.sh', { cwd: PROJECT_DIR, stdio: 'pipe' });
  } catch (e) {
    throw new Error('脚本语法错误');
  }
});

check('afterPack.js 语法正确', () => {
  try {
    execSync('node --check electron/afterPack.js', { cwd: PROJECT_DIR, stdio: 'pipe' });
  } catch (e) {
    throw new Error(e.stderr?.toString() || '语法错误');
  }
});

check('update-manager.js 语法正确', () => {
  try {
    execSync('node --check electron/update-manager.js', { cwd: PROJECT_DIR, stdio: 'pipe' });
  } catch (e) {
    throw new Error(e.stderr?.toString() || '语法错误');
  }
});

check('prebuild-clean.js 语法正确', () => {
  try {
    execSync('node --check scripts/prebuild-clean.js', { cwd: PROJECT_DIR, stdio: 'pipe' });
  } catch (e) {
    throw new Error(e.stderr?.toString() || '语法错误');
  }
});

console.log('\n4. PEM.xml 配置');

check('pom.xml Java 版本为 17', () => {
  const pomXml = fs.readFileSync(path.join(PROJECT_DIR, 'backend/pom.xml'), 'utf-8');
  if (!pomXml.includes('<java.version>17</java.version>')) {
    throw new Error('Java 版本不是 17');
  }
});

check('pom.xml Spring Boot 版本', () => {
  const pomXml = fs.readFileSync(path.join(PROJECT_DIR, 'backend/pom.xml'), 'utf-8');
  if (!pomXml.includes('spring-boot-starter-parent')) {
    throw new Error('缺少 Spring Boot 父 POM');
  }
});

console.log('\n5. Electron IPC 配置');

const preload = fs.readFileSync(path.join(PROJECT_DIR, 'electron/preload.js'), 'utf-8');
const mainJs = fs.readFileSync(path.join(PROJECT_DIR, 'electron/main.js'), 'utf-8');

check('preload.js 暴露了更新 API', () => {
  const apis = ['getVersion', 'getUpdateConfig', 'checkForUpdate', 'downloadAndApplyUpdate'];
  for (const api of apis) {
    if (!preload.includes(api)) throw new Error(`缺少 ${api} 方法`);
  }
});

check('main.js 注册了更新 IPC handlers', () => {
  const handlers = ['check-for-update', 'download-and-apply-update', 'get-update-config'];
  for (const h of handlers) {
    if (!mainJs.includes(h)) throw new Error(`缺少 ${h} IPC handler`);
  }
});

// ============================================================
// 结果汇总
// ============================================================
console.log('\n========================================');
console.log('  验证结果');
console.log('========================================');

if (errors.length === 0) {
  console.log(`  ✓ 全部 ${passed}/${total} 项检查通过`);
  if (warnings.length > 0) {
    console.log(`  ⚠ ${warnings.length} 个警告`);
    warnings.forEach(w => console.log(`    - ${w}`));
  }
  console.log('\n  构建配置验证通过！');
  console.log('  运行以下命令开始构建:');
  console.log('    npm run download-jre:all    # 下载 JRE');
  console.log('    npm run build:jar           # 构建后端');
  console.log('    npm run build:portable:all  # 打包所有平台');
  console.log('    npm run release 1.0.1       # 发布');
  process.exit(0);
} else {
  console.log(`  ✗ ${errors.length} 个错误, ${passed}/${total} 项通过`);
  if (warnings.length > 0) {
    console.log(`  ⚠ ${warnings.length} 个警告`);
    warnings.forEach(w => console.log(`    - ${w}`));
  }
  console.log('\n  错误列表:');
  errors.forEach(e => console.log(`    - ${e}`));
  console.log('\n  请修复以上错误后重新验证');
  process.exit(1);
}
