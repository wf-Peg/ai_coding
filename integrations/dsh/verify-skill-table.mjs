#!/usr/bin/env node
// ============================================================
// CutShelter × DSH 技能包「工具清单」自检脚本
// ------------------------------------------------------------
// 作用：对比 MCP 桥 server.mjs + plugins 里【实际注册】的工具，
//       与 skills/cut-shelter/SKILL.md【工具清单总表】登记的条目，
//       检测两者是否漂移（新增未登记 / 已删除仍残留），并把结果喂给
//       设置页「技能包」区展示，实现技能包的可发现性维护。
//
// 用法：
//   node verify-skill-table.mjs            # 人类可读输出；有漂移时退出码 1
//   node verify-skill-table.mjs --json     # 输出 JSON 便于被 Electron 主进程消费
//
// 输出结构（--json）：
//   {
//     ok, actualCount, documentedCount,
//     actual, documented,
//     missingInDoc,      // 实际有、文档缺 → 新增未登记
//     staleInDoc         // 文档有、实际无 → 已删除/改名未清理
//   }
// ============================================================
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url))); // integrations/dsh/

/**
 * 收集实际注册的工具：MCP 工具 + 本地插件工具。
 * MCP 工具 = server.mjs 中所有 `server.registerTool('name', ...)`。
 * 插件工具 = plugins 下各插件 index.mjs 中所有 `defineTool({ name: 'xxx' })`。
 */
export function collectRegisteredTools(dir = ROOT) {
  const mcpTools = [];
  const serverPath = join(dir, 'mcp-server', 'server.mjs');
  if (existsSync(serverPath)) {
    const src = readFileSync(serverPath, 'utf-8');
    const re = /server\.registerTool\(\s*['"]([A-Za-z0-9_-]+)['"]/g;
    let m;
    while ((m = re.exec(src)) !== null) mcpTools.push(m[1]);
  }

  const pluginTools = [];
  const pluginsDir = join(dir, 'plugins');
  if (existsSync(pluginsDir)) {
    for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pluginFile = join(pluginsDir, entry.name, 'index.mjs');
      if (!existsSync(pluginFile)) continue;
      const src = readFileSync(pluginFile, 'utf-8');
      const re = /defineTool\(\s*\{[\s\S]*?name:\s*['"]([A-Za-z0-9_-]+)['"]/g;
      let m;
      while ((m = re.exec(src)) !== null) pluginTools.push(m[1]);
    }
  }

  return { mcpTools, pluginTools };
}

/**
 * 收集 SKILL.md「工具清单总表」中登记的条目。
 * 只解析「工具清单总表」小节（截至下一个 ##），匹配每行首列序号 + 第二列 `code` 工具名。
 */
export function collectDocumentedTools(dir = ROOT) {
  const docPath = join(dir, 'skills', 'cut-shelter', 'SKILL.md');
  if (!existsSync(docPath)) return [];

  const src = readFileSync(docPath, 'utf-8');
  const section = src.match(/## 工具清单总表[\s\S]*?(?=\n## |$)/)?.[0] || '';
  const names = [];
  const re = /^\|\s*(?:\d+|[—-])\s*\|\s*`([A-Za-z0-9_-]+)`/gm;
  let m;
  while ((m = re.exec(section)) !== null) names.push(m[1]);
  return names;
}

/**
 * 执行工具清单漂移校验。
 */
export function verifySkillTable(dir = ROOT) {
  const { mcpTools, pluginTools } = collectRegisteredTools(dir);
  const actual = [...mcpTools, ...pluginTools]; // MCP 在前、插件在后
  const documented = collectDocumentedTools(dir);

  const actualSet = new Set(actual);
  const docSet = new Set(documented);
  const missingInDoc = actual.filter((t) => !docSet.has(t));
  const staleInDoc = documented.filter((t) => !actualSet.has(t));

  return {
    ok: missingInDoc.length === 0 && staleInDoc.length === 0,
    actualCount: actual.length,
    documentedCount: documented.length,
    actual,
    documented,
    missingInDoc,
    staleInDoc,
  };
}

// ---- CLI 入口（被命令行直接执行时触发） ----
const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const wantJson = process.argv.includes('--json');
  const result = verifySkillTable();

  if (wantJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else if (result.ok) {
    const { mcpTools, pluginTools } = collectRegisteredTools();
    process.stdout.write(
      `✅ 工具清单已同步：MCP ${mcpTools.length} 个 + 插件 ${pluginTools.length} 个 = ${result.actualCount} 个，与 SKILL.md 登记一致。\n`
    );
  } else {
    process.stdout.write('⚠️  工具清单存在漂移：\n');
    if (result.missingInDoc.length) {
      process.stdout.write(`   - 实际已注册、但 SKILL.md 未登记（新增）：${result.missingInDoc.join(', ')}\n`);
    }
    if (result.staleInDoc.length) {
      process.stdout.write(`   - SKILL.md 已登记、但实现中已不存在（删除/改名）：${result.staleInDoc.join(', ')}\n`);
    }
    process.stdout.write(`   请按「技能包维护约定」（SKILL.md 末尾）同步，并更新数量自检（当前应 ${result.documentedCount} 个）。\n`);
  }

  process.exit(result.ok ? 0 : 1);
}