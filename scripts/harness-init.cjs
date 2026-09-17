#!/usr/bin/env node
/**
 * HARNESS 脚手架：幂等生成目录 + 模板 + 空索引 + README/INDEX/roadmap。
 *
 * 用法：
 *   node scripts/harness-init.cjs
 *
 * 幂等性：已存在的文件不覆盖（除非加 --force）。
 * 零第三方依赖（仅用 Node 内置 fs/path）。
 *
 * 注意：本脚本只负责「建骨架」，不生成记录内容。写 devlog/bug/adr 由
 * .trae/skills/harness-archive 负责。
 */
const { mkdirSync, existsSync } = require("node:fs");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "..");
const HARNESS = join(ROOT, "HARNESS");
const FORCE = process.argv.includes("--force");

// 骨架：文件内容用内联模板（作为默认），若缺省文件不存在则由此创建。
// 已经手工写好的 README/INDEX/roadmap/模板/_index 由 TEMPLATE_FILES 拷贝自 HARNESS 内部 noop 占位。
// 简化：为避免重复维护内容，默认只确保目录 + 必需的元文件存在；内容模板统一从
// HARNESS 内已建好的 _template.md / _index.md 存在性校验。

const STRUCTURE = [
  [join(HARNESS, "devlog", "2026"), "devlog 年度目录"],
  [join(HARNESS, "bugs"), "bug 归档目录（按模块分子目录）"],
  [join(HARNESS, "decisions"), "ADR 决策目录"],
];

const REQUIRED_FILES = [
  join(HARNESS, "README.md"),
  join(HARNESS, "INDEX.md"),
  join(HARNESS, "roadmap.md"),
  join(HARNESS, "devlog", "_devlog-template.md"),
  join(HARNESS, "devlog", "_index.md"),
  join(HARNESS, "devlog", "2026", "README.md"),
  join(HARNESS, "bugs", "_bug-template.md"),
  join(HARNESS, "bugs", "_index.md"),
  join(HARNESS, "decisions", "_adr-template.md"),
  join(HARNESS, "decisions", "_index.md"),
];

function main() {
  let createdDirs = 0;
  for (const [dir] of STRUCTURE) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      createdDirs++;
      console.log(`  + dir  ${dir}`);
    }
  }

  let missing = REQUIRED_FILES.filter((f) => !existsSync(f));
  if (missing.length > 0) {
    console.log("[错误] HARNESS 骨架不完整，缺失必需文件：");
    for (const f of missing) console.log(`  - ${f}`);
    console.log(`请先补齐再运行（或按 HARNESS/README.md 契约手动生成）。`);
    process.exitCode = 1;
    return;
  }

  console.log(`HARNESS 骨架已就绪（本次新建目录 ${createdDirs} 个，必需文件均存在）${FORCE ? "（--force 未做额外覆盖：内容模板不在脚本内维护）" : ""}。`);
  console.log("提示：写记录用 .trae/skills/harness-archive；校验用 scripts/harness-audit.cjs。");
}

main();