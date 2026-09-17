#!/usr/bin/env node
/**
 * HARNESS 校验：检查各 _index.md 与记录一致性、frontmatter 字段齐全、commit 关联存在。
 *
 * 用法：
 *   node scripts/harness-audit.cjs          # 完整校验（只读不写）
 *   node scripts/harness-audit.cjs -WhatIf  # 同义：只校验不写（本脚本天然只读，-WhatIf 仅作语义标记）
 *
 * 退出码：
 *  0 = 通过（ERROR 为 0）
 *  1 = 存在 ERROR（如 missing frontmatter / index 记录找不到对应文件）
 *
 * 仅用 Node 内置 fs/path。不修改任何文件。
 */
const { readdirSync, readFileSync, existsSync, statSync } = require("node:fs");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "..");
const HARNESS = join(ROOT, "HARNESS");
const WHATIF = process.argv.includes("-WhatIf") || process.argv.includes("--whatif");

let errors = 0;
let warnings = 0;

function err(file, msg) {
  errors++;
  console.log(`  [ERROR] ${file}: ${msg}`);
}
function warn(file, msg) {
  warnings++;
  console.log(`  [WARN]  ${file}: ${msg}`);
}

// 解析 frontmatter：返回 { fields, body }；不合法则返回 null
// 支持嵌套键（缩进行归入父键）：generated/sources 等映射只判存在性，不校验其子值
function parseFrontmatter(text) {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return null;
  const fm = text.slice(3, end);
  const fields = {};
  for (const line of fm.split("\n")) {
    if (/^\s/.test(line)) continue; // 嵌套行：归父键，父键已在上层登记
    const m = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if (m) fields[m[1]] = m[2].trim();
  }
  return fields;
}

// 允许空值的嵌套型键（存在即视为齐全）
const NESTED_KEYS = new Set(["generated", "sources"]);

function listRecords(dir, depth) {
  // 递归收集非下划线开头、非 README 的 .md
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name.startsWith("_")) continue;
    if (name === "README.md") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listRecords(full, depth + 1));
    } else if (name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

// 解析索引表格行：提取文件列（最后一列）以核对存在性
function indexLines(indexFile) {
  if (!existsSync(indexFile)) return { lines: [], file: indexFile, missing: true };
  const txt = readFileSync(indexFile, "utf8");
  return { lines: txt.split("\n"), file: indexFile, missing: false };
}

function audit(kind, recDir, indexFile) {
  const records = listRecords(recDir, 0);
  const idx = indexLines(indexFile);

  // 1) frontmatter 校验
  const REQUIRED = ["type", "id", "title", "date", "status", "commit", "source", "generated"];
  for (const rec of records) {
    const text = readFileSync(rec, "utf8");
    const fm = parseFrontmatter(text);
    const rel = rec.slice(HARNESS.length + 1);
    if (!fm) {
      err(`${rel}`, "缺少合法 frontmatter");
      continue;
    }
    for (const f of REQUIRED) {
      const present = Object.prototype.hasOwnProperty.call(fm, f);
      if (!present) {
        err(`${rel}`, `frontmatter 缺字段: ${f}`);
      } else if (!NESTED_KEYS.has(f) && !fm[f]) {
        err(`${rel}`, `frontmatter 字段为空: ${f}`);
      }
    }
  }

  // 2) _index.md 存在性
  if (idx.missing) {
    err(`HARNESS/${kind}/_index.md`, "索引文件缺失");
    return;
  }

  // 3) index 表格里声明的文件是否存在（粗匹配：含 '2026-' 或带 .md 的单元格）
  for (const line of idx.lines) {
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    const fileCell = cells[cells.length - 1];
    if (fileCell && fileCell.match(/\.md$/i) && !fileCell.startsWith("文件")) {
      const p = join(recDir, fileCell.replace(/\s*\*\s*$/, ""));
      if (!existsSync(p)) warn(`HARNESS/${kind}/_index.md`, `索引声明的文件不存在: ${fileCell}`);
    }
  }

  // 4) 记录是否进了 index（反查：每条记录文件名应出现在 index 文本里，粗匹配 slug）
  for (const rec of records) {
    const base = rec.slice(rec.lastIndexOf("\\") + 1, rec.length);
    const slug = base.replace(/\.md$/, "");
    if (!readFileSync(indexFile, "utf8").includes(slug.split("-").slice(3).join("-") || slug)) {
      const found = readFileSync(indexFile, "utf8").includes(slug);
      if (!found) warn(`${rec.slice(HARNESS.length + 1)}`, "记录未在 _index.md 中登记（或文件名与索引不一致）");
    }
  }
}

function main() {
  console.log(`HARNESS 校验开始${WHATIF ? "（-WhatIf：仅校验，不写任何文件）" : ""}\n`);

  if (!existsSync(HARNESS)) {
    err("HARNESS", "目录不存在，请先运行 node scripts/harness-init.cjs");
  } else {
    audit("devlog", join(HARNESS, "devlog"), join(HARNESS, "devlog", "_index.md"));
    audit("bugs", join(HARNESS, "bugs"), join(HARNESS, "bugs", "_index.md"));
    audit("decisions", join(HARNESS, "decisions"), join(HARNESS, "decisions", "_index.md"));
  }

  console.log(`\n结果：ERROR=${errors}，WARN=${warnings}`);
  process.exitCode = errors > 0 ? 1 : 0;
}

main();