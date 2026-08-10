# Obsidian Vault 路径配置化设计方案

## 1. 功能说明

### Web Clipper 同步功能是做什么的？

**场景**：你用 Obsidian Web Clipper 浏览器插件剪藏网页 → 插件自动将网页转为 Markdown 文件（含 frontmatter）写入 `obsidian-vault/sources/` 目录 → `SourceSyncService` 定期扫描该目录，解析 frontmatter 中的标题/URL/标签/摘要等信息 → 自动创建剪藏记录到 CutShelter 的剪藏列表。

**关键特征**：
- 原文不复制，使用 Obsidian wiki-link `[[sources/文件名|标题]]` 引用，vault 是唯一真源
- 与另一个并行服务 `VaultWatchService`（LLM Wiki AI 批量入库）独立运行，互不干扰
- 已同步文件通过 `wiki/.synced-files` 持久化去重
- 同步状态在剪藏页面的 `Web Clipper 同步：已同步 N 条，待同步 M 条` 显示

### 涉及的全部路径

| 路径 | 用途 | 使用方 |
|---|---|---|
| `{vaultPath}/sources/` | Web Clipper 写入的原始 .md 文件 | SourceSyncService, VaultWatchService |
| `{vaultPath}/wiki/.synced-files` | 已同步剪藏去重标记 | SourceSyncService |
| `{vaultPath}/wiki/.processed-files` | 已 AI 处理去重标记 | VaultWatchService |
| `{vaultPath}/wiki/entities/` | AI 生成的实体页面 | WikiPageService |
| `{vaultPath}/wiki/concepts/` | AI 生成的概念页面 | WikiPageService |
| `{vaultPath}/wiki/synthesis/` | 综述页面 | WikiPageService |
| `{vaultPath}/wiki/sources/` | 来源页面（AI 生成的摘要） | WikiPageService |
| `{vaultPath}/wiki/index.md` | 页面索引 | WikiIndexService |
| `{vaultPath}/wiki/log.md` | 操作日志 | WikiIndexService |
| `{vaultPath}/wiki/lint-report.md` | 健康检查报告 | WikiLintService |
| `{vaultPath}/wiki/MOC_*.md` | MOC 索引页 | MocGeneratorService |

## 2. 当前状态分析

### 路径解析不一致问题

当前 `vaultPath` 的解析方式在各服务中不一致：

| 服务 | 解析方式 | 状态 |
|---|---|---|
| **SourceSyncService** | 通过 `resolveVaultPath()` 以 `AppConfig.storagePath` 为基准解析相对路径 | ✅ 已修复 |
| **VaultWatchService** | 直接 `Paths.get(config.getVaultPath())` | ❌ 未修复 |
| **WikiPageService** | 直接 `Paths.get(config.getVaultPath())` | ❌ 未修复 |
| **WikiIndexService** | 直接 `Paths.get(config.getVaultPath())` | ❌ 未修复 |
| **WikiLintService** | 直接 `Paths.get(wikiConfig.getVaultPath())` | ❌ 未修复 |
| **MocGeneratorService** | 直接 `Paths.get(wikiConfig.getVaultPath())` | ❌ 未修复 |

### 当前配置现状

```yaml
# application.yml
clip:
  storage:
    path: L:\归档\...\Clip_Bed\clip-storage  # 存储根路径（clip-storage 子目录）

# application_templete.yml
wiki:
  vault-path: ./obsidian-vault  # 相对路径，默认从 JVM 工作目录解析
```

## 3. 用户决策

用户确认：
- **`obsidian-vault` 位置**：在存储根目录下，与 `clip-storage` 同级
- **配置方式**：自动派生，无需手动配置

## 4. 设计方案

### 核心思路

在 `WikiConfig` 中统一处理路径解析，让所有服务共享同一个正确的 vault 路径，**消除多个服务各自解析的不一致问题**。

### 具体修改

#### 4.1 `WikiConfig.java` - 新增 vault 路径自动解析

- 注入 `AppConfigService`
- 添加 `@PostConstruct` 方法 `resolveVaultPath()`：
  - 如果 `vaultPath` 是**绝对路径**，直接使用（用户自定义覆盖）
  - 如果 `vaultPath` 是**相对路径**（默认 `./obsidian-vault`），以 `AppConfig.storagePath` 为基准解析
  - 将解析后的绝对路径写回 `vaultPath` 字段
- 使用 `@DependsOn("appConfigService")` 确保 `AppConfigService` 先初始化

#### 4.2 `SourceSyncService.java` - 回退为直接使用 `wikiConfig.getVaultPath()`

- 移除 `resolveVaultPath()` 方法
- 移除 `AppConfigService` 依赖
- `getSourcesDir()` 和 `getSyncedFilesPath()` 恢复为直接使用 `Paths.get(wikiConfig.getVaultPath())`
- 因为 `WikiConfig.getVaultPath()` 现在返回的已经是正确的绝对路径

#### 4.3 `application_templete.yml` - 更新 vault-path 注释

- 将 `vault-path: ./obsidian-vault` 的注释更新为：
  ```yaml
  vault-path: ./obsidian-vault  # 可选，默认自动解析为 {storagePath}/obsidian-vault
  ```

### 修改文件清单

| 文件 | 修改类型 | 说明 |
|---|---|---|
| `backend/.../config/WikiConfig.java` | 修改 | 注入 `AppConfigService`，新增 `@PostConstruct resolveVaultPath()` |
| `backend/.../service/sync/SourceSyncService.java` | 修改 | 回退 `resolveVaultPath()` 和 `AppConfigService` 依赖，简化代码 |
| `backend/src/main/resources/application_templete.yml` | 修改 | 更新 `vault-path` 注释 |

### 路径解析逻辑

```
WikiConfig.vaultPath = "./obsidian-vault" (默认)
                           │
                           ▼
                   是绝对路径吗？
                    ┌────┴────┐
                    YES       NO
                     │         │
                     ▼         ▼
                  直接使用    AppConfig.storagePath = "L:\...\Clip_Bed"
                     │         │
                     │         ▼
                     │    Clip_Bed/obsidian-vault
                     │         │
                     └────┬────┘
                          ▼
                vaultPath = "L:\...\Clip_Bed\obsidian-vault"
                          │
                          ▼
          所有服务统一使用此绝对路径
```

### 边界情况

1. **`AppConfig.storagePath` 为空**：回退到原始相对路径（从 JVM 工作目录解析），保持向后兼容
2. **用户配置了绝对路径**：如 `vault-path: D:\MyVault`，直接使用，不进行相对路径解析
3. **用户自定义了其他相对路径**：如 `vault-path: ./my-vault`，以 `storagePath` 为基准解析为 `{storagePath}/my-vault`
4. **初始化顺序**：`WikiConfig` 用 `@DependsOn("appConfigService")` 确保 `AppConfigService` 先初始化

## 5. 验证步骤

1. `mvn compile` 确认后端编译通过
2. 检查 `WikiConfig.resolveVaultPath()` 日志输出，确认路径解析正确
3. 重启后端后，点击"立即同步"，确认不再报 `sources directory not found`
4. 如果 `sources/` 目录存在且包含 .md 文件，确认同步条数正确更新