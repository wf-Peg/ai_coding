# 密码库导入功能设计方案

> 支持导入 Chrome 浏览器密码 + 浏览器插件右键导入当前网站密码

## 一、背景与目标

### 1.1 用户需求
1. **CSV 批量导入**：支持将 Chrome 浏览器导出的密码 CSV 文件批量导入到本地密码库
2. **插件右键导入**：在浏览器插件右键菜单中增加「导入当前网站密码」功能，快速把当前正在浏览的网站账号密码存入密码库

### 1.2 设计目标
- 复用现有 vault 架构（DES 加密、零知识、本地存储）
- 导入数据落盘前必须经过 DES 加密，明文不持久化
- 插件与桌面端共用同一套 `/api/vault` REST API
- 用户体验：导入前可预览、可去重、可撤销

---

## 二、市场参考

| 产品 | CSV 导入 | 浏览器插件自动捕获 |
|---|---|---|
| Bitwarden | 支持 Chrome/Firefox/1Password/LastPass CSV | 插件检测到登录表单提交时弹窗询问保存 |
| 1Password | 支持 CSV，导入前预览去重 | 插件捕获表单提交，自动识别用户名/密码字段 |
| KeePass | CSV 导入向导，字段映射 | 无插件捕获（桌面应用） |
| LastPass | CSV 自动导入 | 插件捕获表单提交自动保存 |

**借鉴结论**：
- 导入流程参考 Bitwarden：上传 → 解析预览 → 去重检查 → 确认导入
- 插件捕获参考 1Password：自动识别当前页面 URL/标题，用户手动填写账号密码（不做表单自动抓取，避免侵入性）
- 不做表单自动抓取的原因：Chrome 已有原生密码保存弹窗，重复抓取易冲突；手动填写更可控

---

## 三、Chrome CSV 格式规范

### 3.1 标准 CSV 格式（Chrome 78+）
```csv
name,url,username,password
Google,https://accounts.google.com,user@gmail.com,myPassword123
GitHub,https://github.com,myuser,ghp_xxxx
```

### 3.2 字段映射
| Chrome CSV 列 | PasswordEntry 字段 | 说明 |
|---|---|---|
| `name` | `title` | 站点名称 |
| `url` | `url` | 网址 |
| `username` | `username` | 用户名 |
| `password` | `password` | 密码（导入后随库 DES 加密） |
| （自动生成） | `category` | 固定为 `login` |
| （自动生成） | `tags` | 默认含 `imported`、`chrome` 两个标签 |
| （自动生成） | `iconColor` | 根据 url 域名 hash 生成颜色 |

### 3.3 兼容性处理
- 表头大小写不敏感（`URL`/`url`/`Url` 均接受）
- 表头可选列：`name`（缺失时用域名作为 title）
- 字段含逗号时必须用双引号包裹（标准 CSV 转义）
- 跳过空行、跳过 username 和 password 均为空的行
- 编码：UTF-8（Chrome 导出默认）

---

## 四、后端设计

### 4.1 修复：PasswordVaultController 添加 @CrossOrigin

**问题**：当前 `PasswordVaultController` 是唯一缺少 `@CrossOrigin(origins = "*")` 注解的业务控制器，浏览器插件跨域调用 `/api/vault/*` 会被拦截。

**修复**：在类上添加 `@CrossOrigin(origins = "*")`，与 ClipController、TodoController 等 6 个控制器保持一致。

```java
@RestController
@RequestMapping("/api/vault")
@CrossOrigin(origins = "*")  // 新增：允许浏览器插件跨域访问
public class PasswordVaultController { ... }
```

### 4.2 新增：PasswordVaultService 批量导入方法

```java
/**
 * 批量导入密码条目（去重）。
 *
 * @param entries 待导入的条目列表
 * @return 导入结果统计 {imported, skipped, duplicates, errors}
 */
public Map<String, Object> importEntries(List<PasswordEntry> entries)
```

**去重策略**：
- 唯一键：`url + username`（忽略 url 末尾斜杠和查询参数的差异）
- 已存在相同 `url + username` 的条目：跳过，计入 `skipped`
- 同批次内重复：只保留第一条，计入 `duplicates`
- 数据校验失败（如 password 为空）：计入 `errors`，不影响其他条目

**安全要求**：
- 调用前 `ensureUnlocked()` 校验解锁状态
- 导入的条目统一设置：`category=login`、`tags=[imported, chrome]`、`createdAt=now`、`id=自增`
- 全部条目加入 `cachedVault.entries` 后调用 `saveVault()` 一次性加密落盘

### 4.3 新增：PasswordVaultController 导入端点

```java
@PostMapping("/import")
public ResponseEntity<?> importEntries(@RequestBody Map<String, Object> body) {
    // body: { entries: [ {title, url, username, password, ...}, ... ] }
    // 返回: { imported: N, skipped: N, duplicates: N, errors: N, details: [...] }
}
```

**为什么不直接传 CSV 文本？**
- CSV 解析放在前端（vault.html），前端解析后传 JSON 数组，后端只负责存储
- 好处：前端可做预览、字段映射、错误提示；后端逻辑简单复用 `addEntry` 的数据模型
- 浏览器插件也可直接调用此接口传 JSON（无需构造 CSV）

### 4.4 新增：PasswordVaultService 检查解锁状态端点（轻量）

```java
// 复用现有 GET /api/vault/status，已返回 unlocked 字段
// 插件通过此接口判断是否可导入，无需新增端点
```

### 4.5 完整 API 清单（新增部分）

| HTTP | 路径 | 入参 | 返回 | 说明 |
|---|---|---|---|---|
| POST | `/api/vault/import` | `{entries: [...]}` | `{imported, skipped, duplicates, errors}` | 批量导入（去重） |

其余 11 个端点保持不变。

---

## 五、前端设计（vault.html）

### 5.1 导入入口

在 vault.html 侧边栏底部「安全审计」按钮上方新增「导入密码」按钮（带向下箭头图标）。

```html
<button class="sidebar-action-btn" onclick="showImportModal()">
  <svg>...导入图标...</svg>
  导入密码
</button>
```

### 5.2 导入模态框（新增第 6 个模态框）

**三步式导入向导**：

**步骤 1：选择来源**
- 单选按钮：
  - ○ Chrome CSV 文件（默认）
  - ○ 其他密码管理器 CSV（Bitwarden/1Password/LastPass）
- 文件选择按钮（接受 `.csv`）
- 「如何从 Chrome 导出？」帮助链接（弹出说明：Chrome 设置 → 自动填充 → 密码 → 导出）
- 拖拽区域：支持拖拽 CSV 文件到此处

**步骤 2：预览与去重**
- 表格展示解析结果：`选择 | 名称 | 网址 | 用户名 | 密码(掩码) | 状态`
- 状态列：`新增` / `重复(已存在，将跳过)` / `同批重复` / `数据不全`
- 默认勾选所有「新增」项，用户可取消勾选
- 顶部统计条：「共 N 条，新增 M 条，重复 K 条」

**步骤 3：导入结果**
- 成功提示：「成功导入 N 条密码」
- 跳过列表：展示被跳过的重复条目
- 「完成」按钮关闭模态框并刷新列表

### 5.3 CSV 解析逻辑（前端 JS）

```javascript
function parseCsv(text) {
  // 1. 按行分割（处理 \r\n 和 \n）
  // 2. 解析表头，建立列名→索引映射（大小写不敏感）
  // 3. 逐行解析（处理引号转义、字段内逗号、字段内换行）
  // 4. 映射为 PasswordEntry 对象数组
  // 5. 调用 GET /api/vault/search 获取现有条目，标记重复
}
```

**字段映射表**（支持多种 CSV 来源）：

| 来源 | name 列 | url 列 | username 列 | password 列 |
|---|---|---|---|---|
| Chrome | `name` | `url` | `username` | `password` |
| Bitwarden | `folder` 或 `name` | `login_uri` | `login_username` | `login_password` |
| 1Password | `Title` | `URLs` | `Username` | `Password` |
| LastPass | `name` | `url` | `username` | `password` |

### 5.4 安全提示

导入模态框顶部固定显示安全提示条：
> ⚠️ CSV 文件包含明文密码，导入完成后请立即删除原始 CSV 文件并清空回收站。

---

## 六、浏览器插件设计

### 6.1 右键菜单新增项

在 `background.js` 的 `createContextMenus` 函数中，在现有「智能剪藏」根菜单下新增子菜单项：

```javascript
chrome.contextMenus.create({
  id: 'vault-import-current',
  title: '导入当前网站密码到密码库',
  contexts: ['page'],
  parentId: 'clip-main'  // 作为现有根菜单的子项
});
```

**为什么不新建独立根菜单？**
- 复用现有「智能剪藏」根菜单，避免右键菜单过多
- 与现有剪藏功能归类一致

**替代方案（推荐）**：考虑到密码导入是独立功能，建议新建独立根菜单「密码管理」，避免与剪藏功能混淆：

```javascript
chrome.contextMenus.create({
  id: 'vault-main',
  title: '密码管理',
  contexts: ['page']
});
chrome.contextMenus.create({
  id: 'vault-import-current',
  title: '保存当前网站密码',
  contexts: ['page'],
  parentId: 'vault-main'
});
chrome.contextMenus.create({
  id: 'vault-open',
  title: '打开密码库',
  contexts: ['page'],
  parentId: 'vault-main'
});
```

### 6.2 新增弹窗页面：import-password.html

点击「保存当前网站密码」后打开独立弹窗（而非 popup），尺寸 420×520。

**页面结构**：
```
┌─────────────────────────────────┐
│  保存密码到密码库            [×] │
├─────────────────────────────────┤
│  网站名称                        │
│  [____________________]          │
│                                  │
│  网址（自动填充，可编辑）         │
│  [____________________]          │
│                                  │
│  用户名                          │
│  [____________________]          │
│                                  │
│  密码                            │
│  [____________________] [👁]     │
│                                  │
│  备注（可选）                    │
│  [____________________]          │
│                                  │
│  标签                            │
│  [____________________]          │
│                                  │
│  ┌────────────────────────────┐ │
│  │ ⚠️ 密码库未解锁，请先解锁   │ │  ← 未解锁时显示
│  │ [前往密码库解锁]            │ │
│  └────────────────────────────┘ │
│                                  │
│         [取消]  [保存密码]       │
└─────────────────────────────────┘
```

**自动填充逻辑**：
- 网站名称：`tab.title`（去掉后缀 `- 网站名` 等）
- 网址：`tab.url`（去掉 hash 和查询参数中的敏感信息）
- 用户名/密码：留空，用户手动填写

**密码可见性切换**：眼睛图标切换 `type="password"` ↔ `type="text"`

### 6.3 保存流程

```javascript
async function savePassword() {
  // 1. 检查 vault 状态
  const status = await fetch(`${API_BASE}/api/vault/status`).then(r => r.json());
  if (!status.unlocked) {
    showUnlockWarning();  // 显示未解锁提示
    return;
  }

  // 2. 构造 entry
  const entry = {
    title: titleInput.value,
    url: urlInput.value,
    username: usernameInput.value,
    password: passwordInput.value,
    notes: notesInput.value,
    tags: tagsInput.value ? tagsInput.value.split(',').map(s => s.trim()) : [],
    category: 'login'
  };

  // 3. 调用后端
  const res = await fetch(`${API_BASE}/api/vault/entry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry)
  });

  if (res.ok) {
    showSuccess('密码已保存到密码库');
    setTimeout(() => window.close(), 1500);
  } else {
    const err = await res.json();
    showError(err.error || '保存失败');
  }
}
```

### 6.4 API 地址配置

复用 `options.js` 中的 `apiUrl` 配置（默认 `http://localhost:8081`），从中提取 host:port 作为 vault API base。

```javascript
// import-password.js
async function getVaultApiBase() {
  const config = await chrome.storage.local.get('apiUrl');
  const apiUrl = config.apiUrl || 'http://localhost:8081/api/clip/add';
  // 从 /api/clip/add 提取 http://localhost:8081
  return apiUrl.replace(/\/api\/.*$/, '');
}
```

### 6.5 「打开密码库」菜单项

```javascript
// background.js
case 'vault-open':
  chrome.tabs.create({
    url: chrome.runtime.getURL('index.html#/vault')
  });
  break;
```

利用 index.html 已有的 SPA 路由，直接打开 vault 视图。

### 6.6 manifest.json 变更

```json
{
  "permissions": ["contextMenus", "storage", "activeTab", "scripting"],
  // permissions 无需新增（已有 contextMenus 和 activeTab）
  
  "web_accessible_resources": [{
    "resources": ["import-password.html", "index.html", ...]
    // 新增 import-password.html
  }]
}
```

---

## 七、数据流与时序

### 7.1 CSV 导入流程

```
用户在 Chrome 导出 CSV
  ↓
用户在 vault.html 点击「导入密码」
  ↓
选择 CSV 文件（或拖拽）
  ↓
前端解析 CSV → JSON 数组
  ↓
GET /api/vault/search 获取现有条目
  ↓
前端去重标记，展示预览表格
  ↓
用户勾选要导入的条目
  ↓
POST /api/vault/import { entries: [...] }
  ↓
后端 ensureUnlocked() → 合并去重 → saveVault() (DES 加密落盘)
  ↓
返回 { imported: N, skipped: N, ... }
  ↓
前端展示结果 → 刷新列表
```

### 7.2 插件右键导入流程

```
用户浏览网站，已登录或准备登录
  ↓
右键 → 密码管理 → 保存当前网站密码
  ↓
打开 import-password.html 弹窗
  ↓
自动填充 tab.title 和 tab.url
  ↓
GET /api/vault/status 检查解锁状态
  ↓ 未解锁
显示警告 + 「前往密码库解锁」按钮
  ↓ 已解锁
用户填写用户名/密码/备注
  ↓
POST /api/vault/entry
  ↓
成功提示 → 1.5s 后自动关闭弹窗
```

---

## 八、安全考量

| 风险 | 缓解措施 |
|---|---|
| CSV 明文泄露 | 导入完成提示用户删除原文件；不缓存 CSV 内容到磁盘 |
| 插件传输被劫持 | 仅调用 `localhost:8080`，不经过外网；host_permissions 已限定 |
| DES Key 暴露 | 插件不接触 DES Key，只通过后端 status 判断解锁状态 |
| 重复导入 | url+username 去重，避免重复条目污染 |
| 跨站脚本注入 | 后端对 title/url/username 做长度限制（各 ≤500 字符） |
| 暴力导入 | import 接口单次最多 2000 条，超过拒绝 |

---

## 九、UI/UX 细节

### 9.1 vault.html 导入模态框样式

复用现有模态框样式（`.modal-overlay`、`.modal-card`），新增：
- 步骤指示器（3 个圆点 + 连接线）
- 预览表格（紧凑型，斑马纹）
- 拖拽区域（虚线边框 + 悬停高亮）

### 9.2 import-password.html 样式

- 尺寸 420×520，无地址栏（独立窗口）
- 复用 `styles/theme-notion.css` 保持视觉一致
- 表单输入框样式与 vault.html 的 `.modal-input` 一致
- 保存按钮主色 `#6366f1`（与 vault 主题色一致）

### 9.3 浏览器窗口打开方式

```javascript
chrome.windows.create({
  url: chrome.runtime.getURL('import-password.html'),
  type: 'popup',
  width: 440,
  height: 560
});
```

---

## 十、实现清单

### 10.1 后端（2 个文件）

| 文件 | 改动 |
|---|---|
| `PasswordVaultController.java` | 添加 `@CrossOrigin(origins = "*")`；新增 `POST /import` 端点 |
| `PasswordVaultService.java` | 新增 `importEntries(List<PasswordEntry>)` 方法（去重+批量保存） |

### 10.2 前端 vault.html（1 个文件）

| 改动点 | 说明 |
|---|---|
| 侧边栏新增「导入密码」按钮 | 位于「安全审计」上方 |
| 新增导入模态框 `importModal` | 三步向导：选择来源 → 预览去重 → 导入结果 |
| 新增 `parseCsv()` 函数 | CSV 解析 + 字段映射 + 多来源兼容 |
| 新增 `showImportModal()`/`doImport()` | 模态框控制 + 调用 `/api/vault/import` |

### 10.3 浏览器插件（4 个文件）

| 文件 | 改动 |
|---|---|
| `manifest.json` | `web_accessible_resources` 新增 `import-password.html` |
| `background.js` | `createContextMenus` 新增「密码管理」根菜单 + 2 个子项；`handleContextMenuClick` 新增 `vault-import-current`、`vault-open` 分支 |
| `import-password.html` | 新建：弹窗页面结构 |
| `import-password.js` | 新建：自动填充 + 解锁检查 + 保存逻辑 |

### 10.4 验证步骤

1. **CSV 导入**：
   - Chrome 导出测试 CSV → vault.html 导入 → 验证条目数正确 → 验证去重生效
   - 重复导入同一 CSV → 全部标记为重复跳过
   - 导入 Bitwarden CSV → 字段映射正确

2. **插件右键导入**：
   - vault 未解锁时右键 → 弹窗显示未解锁警告
   - vault 已解锁时右键 → 弹窗自动填充网站信息 → 填写密码保存 → vault.html 列表出现新条目
   - 「打开密码库」→ 浏览器新标签打开 index.html#/vault

3. **跨域验证**：
   - 插件调用 `/api/vault/status` 不被 CORS 拦截
   - 插件调用 `/api/vault/entry` 成功保存

---

## 十一、不做的事（明确排除）

- ❌ 不做表单自动抓取（避免与 Chrome 原生密码保存冲突）
- ❌ 不在插件中输入 DES Key（Key 只在桌面端 vault.html 输入）
- ❌ 不支持从 Chrome 直接读取密码（Chrome 不开放此 API，必须用户手动导出 CSV）
- ❌ 不做 CSV 模板下载（Chrome 导出的格式即是标准格式）
- ❌ 不做导入历史记录（一次性操作，无需追溯）

---

## 十二、未来扩展（不在本期）

- 支持 Firefox / Safari CSV 导入
- 支持从其他密码管理器导入（KeePass KDBX、1Password OPVAULT）
- 插件检测到登录表单提交时主动弹窗询问保存
- 密码库导出为加密备份文件（DES 加密的 JSON）
