#!/usr/bin/env node
/**
 * 生成项目代码索引 CODE_INDEX.md（人 + AI 双通道用的静态地图）。
 *
 * 目的：
 *  - 让人能快速浏览项目「哪些文件、定义了哪些类/函数/方法/路由」；
 *  - 让 AI 在会话开始时读一次即可获得项目骨架，从而快速定位文件与行号，
 *    避免盲目 grep / 整文件读取，降低 token 消耗。
 *
 * 产物 CODE_INDEX.md 是受控生成物：结构变化后重跑本脚本覆盖即可，勿手改。
 * 零第三方依赖（仅用 Node 内置 fs/path）。
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = join(ROOT, "CODE_INDEX.md");

// 扫描的一手源码目录（相对仓库根）
const MODULES = [
  { name: "electron", root: "electron", note: "Electron 主进程 / preload / 服务" },
  { name: "frontend", root: "frontend", note: "前端页面（编辑器/工作台/剪藏/工具等）" },
  { name: "backend", root: "backend/src", note: "Spring 后端（REST API / 服务 / 配置）" },
  { name: "scripts", root: "scripts", note: "构建 / 打包 / 工具脚本" },
  { name: "integrations", root: "integrations", note: "DSH / MCP 集成" },
];

// 跳过的目录 / 后缀（保留一手源码，剔除依赖与构建产物）
const SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|build|target|out|jre|jre-slim|jdk|clip-storage|too-lang-tools)(\/|$)/;
const SKIP_EXT = /\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|eot|map|jar|class|pyc|zip|gz|lock)$/i;
const MAX_FILE_KB = 200; // 超过该大小的文件跳过（如压缩/混淆产物）

// 各语言的「定义抽取」规则：返回 { kind, name, line }[]
function extractors(ext) {
  const common = [];
  if (ext === ".java") {
    // 类 / 接口 / 枚举 / record
    common.push(/\b(class|interface|enum|record|annotation)\s+([A-Za-z_][\w]*)/g);
    // 方法签名
    common.push(/\b(?:public|private|protected)\s+(?:static\s+)?[\w<>[\],\s]+\s+([a-z_]\w*)\s*\([^;{]*\)/g);
  } else if (ext === ".js" || ext === ".mjs" || ext === ".cjs" || ext === ".jsx" || ext === ".ts" || ext === ".tsx") {
    common.push(/\bclass\s+([A-Za-z_$][\w$]*)/g);
    common.push(/(?:^|\s)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g);
    common.push(/(?:^|\s)(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>)/g);
    // 路由定义（通用模式）router.get / app.post / @Get 等
    common.push(/\b(?:router|Route|app|server)\.[a-z]+\('([^']+)'/g);
  }
  return common;
}

function definitionsFor(ext, text) {
  const out = [];
  const lines = text.split("\n");
  for (const re of extractors(ext)) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const lineNo = text.slice(0, m.index).split("\n").length;
      const name = (m[1] ?? m[0]).trim();
      if (!name || name.length < 2) continue;
      // 去重（同名同 kind 只留首个）
      if (!out.some((d) => d.name === name)) out.push({ name, line: lineNo });
    }
  }
  // 排序：先出现者在前
  out.sort((a, b) => a.line - b.line);
  void lines;
  return out;
}

function walk(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.test(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full));
    } else if (entry.isFile()) {
      const st = statSync(full);
      if (st.size > MAX_FILE_KB * 1024) continue;
      const ext = extname(entry.name);
      if (SKIP_EXT.test(entry.name)) continue;
      if (!extractors(ext).length) continue; // 只处理可抽取定义的语言
      results.push(full);
    }
  }
  return results;
}

function extname(p) {
  const i = p.lastIndexOf(".");
  return i <= 0 ? "" : p.slice(i).toLowerCase();
}

/** 把定义串成一行紧凑描述：类×N · fn(...) · fn2(...) … 控制长度 */
function summarize(defs, maxLen = 150) {
  if (!defs.length) return "";
  const kinds = new Set(defs.map((d) => d.kind).filter(Boolean));
  let head = defs.map((d) => `${d.name}@L${d.line}`).join(" · ");
  if (head.length > maxLen) {
    head = head.slice(0, maxLen).replace(/(·\s*)?[^·]{1,20}$/, "…");
  }
  const tag = kinds.size ? ` [${[...kinds].join(",")}]` : "";
  return `${head}${tag}`;
}

function build() {
  const lines = [];
  lines.push("# CODE_INDEX — 项目代码索引（人 + AI）");
  lines.push("");
  lines.push("> 生成本文件：`npm run codeindex:gen`（Node 内置，零依赖）。**此文件为生成物，勿手改，结构变化后重跑覆盖。**");
  lines.push("> 精确符号/调用方查询：`codegraph` CLI 或 MCP（搜 `npm run codeindex` 说明）。");
  lines.push("");
  lines.push("按模块列出了各文件的类/函数/方法/路由定义与起始行号，供人和 AI 快速定位。");
  lines.push("");

  const stats = [];
  for (const mod of MODULES) {
    const dir = join(ROOT, mod.root);
    if (!readdirSync(dir, { withFileTypes: true })) continue;
    const files = walk(dir);
    lines.push(`## ${mod.name} — ${mod.note}`);
    lines.push("");
    let fileCount = 0;
    for (const f of files) {
      const rel = relative(ROOT, f).replaceAll("\\", "/");
      const raw = readFileSync(f, "utf8");
      const defs = definitionsFor(extname(f), raw);
      const summary = summarize(defs);
      fileCount++;
      lines.push(`- \`${rel}\`${summary ? " — " + summary : ""}`);
    }
    lines.push("");
    stats.push(`${mod.name}:${fileCount}文件`);
  }

  lines.push("---");
  const total = stats.map((s) => s.split(":")[1].replace("文件", "")).reduce((a, b) => a + +b, 0);
  lines.push(`生成于 ${new Date().toISOString()} · ${total} 个一手源码文件。用 ` + "`npm run codeindex:gen` 重新生成。");
  lines.push("");

  writeFileSync(OUT, lines.join("\n"), "utf8");
  process.stdout.write(`✓ 已生成 ${relative(ROOT, OUT)}（${total} 文件，${lines.length} 行）\n`);
}

build();