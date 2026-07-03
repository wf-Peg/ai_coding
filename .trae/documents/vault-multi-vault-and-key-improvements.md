# 密码模块改进方案

> 修复错误提示、优化 DES Key 生成流程、增加多密码库概念

## 一、问题分析

### 问题 1：错误提示不准确

**现状**（[vault.html#L637-L639](file:///workspace/frontend/vault.html#L637-L639)）：
```javascript
} catch (e) {
    errEl.textContent = '解锁失败，请检查后端服务是否运行';
}
```
`catch` 块捕获所有异常（网络错误、后端返回 error、JSON 解析失败等），统一显示"检查后端服务是否运行"，但实际原因可能是：
- 后端返回了 `data.error`（如"DES Key 不正确"、"密码库不存在"）
- 网络不可达（后端未启动）
- 响应格式异常

**根因**：`doUnlock()` 中 `data.error` 的处理（第 625-628 行）只在 `res.json()` 成功时生效，但 `fetch` 失败或网络异常会直接跳到 `catch` 块。

### 问题 2：DES Key 生成流程不完善

**现状**：
- `showInitModal()`（[vault.html#L655-L658](file:///workspace/frontend/vault.html#L655-L658)）：打开输入框，用户可以手动输入或点击"生成"
- `generateInitKey()`（[vault.html#L659-L661](file:///workspace/frontend/vault.html#L659-L661)）：调用 `generateKeyLocal()` 填入输入框
- `showGenerateKeyModal()`（[vault.html#L687-L691](file:///workspace/frontend/vault.html#L687-L691)）：生成 Key 并复制到剪贴板，仅 toast 提示

**缺失**：
- 没有"自定义 Key"的明确引导
- 生成 Key 后没有保存提示（只是 toast"已复制到剪贴板"一闪而过）
- 没有"丢失后不可恢复"的警告
- 下次进入密码模块时，Key 不在本地任何位置，用户必须自己记住或保存

### 问题 3：无多密码库支持

**现状**：只支持一个密码库，文件路径固定为 `{storagePath}/vault/vault.enc`。如果用户丢失 Key，只能重新初始化，旧密码库文件被覆盖。

**需求**：用户丢失 Key 后，可创建新密码库使用新 Key，旧密码库文件保留。记起旧 Key 后可切换回来。

---

## 二、架构设计

### 2.1 密码库文件结构

```
{storagePath}/vault/
├── vaults.json              ← 新增：密码库注册表（非敏感）
├── default/                 ← 默认密码库目录
│   ├── vault.enc            ← DES 加密的密码数据
│   └── vault-meta.json      ← 元数据（keyCheckHash 等）
├── work/                    ← 工作密码库目录
│   ├── vault.enc
│   └── vault-meta.json
└── personal/                ← 个人密码库目录
    ├── vault.enc
    └── vault-meta.json
```

### 2.2 vaults.json 注册表

```json
{
  "active": "default",
  "vaults": {
    "default": {
      "name": "default",
      "label": "主密码库",
      "keyCheckHash": "abc12345",
      "algorithm": "DES/ECB/PKCS5Padding",
      "createdAt": 1700000000000,
      "entryCount": 42
    }
  }
}
```

### 2.3 向后兼容

旧版 `vault/` 目录下直接有 `vault.enc` 和 `vault-meta.json`。启动时检测：如果 `vaults.json` 不存在，自动迁移旧文件到 `vault/default/` 子目录，然后创建 `vaults.json`。

---

## 三、后端改动

### 3.1 PasswordVaultService

**文件**：[PasswordVaultService.java](file:///workspace/backend/src/main/java/com/example/clip/service/PasswordVaultService.java)

#### 新增字段

```java
/** 密码库注册表缓存 */
private Map<String, VaultMeta> vaultRegistry = new HashMap<>();

/** 当前激活的密码库名称 */
private String activeVaultName = "default";
```

#### 新增内部类 VaultMeta

```java
public static class VaultMeta {
    private String name;
    private String label;
    private String keyCheckHash;
    private String algorithm = "DES/ECB/PKCS5Padding";
    private long createdAt;
    private int entryCount;

    public VaultMeta() {}
    public VaultMeta(String name, String label, String keyCheckHash) {
        this.name = name;
        this.label = label;
        this.keyCheckHash = keyCheckHash;
        this.createdAt = System.currentTimeMillis();
    }
    // getters and setters
}
```

#### 方法改动清单

| 方法 | 改动 |
|---|---|
| `getVaultDir()` | 改为 `getVaultDir(String vaultName)`，路径为 `{storagePath}/vault/{vaultName}/` |
| `getVaultFile(vaultName)` | 新增参数，返回 `{vaultDir}/vault.enc` |
| `getMetaFile(vaultName)` | 新增参数，返回 `{vaultDir}/vault-meta.json` |
| `getVaultsFile()` | 新增，返回 `{storagePath}/vault/vaults.json` |
| `loadVaultsRegistry()` | 新增，读取 vaults.json 到内存 |
| `saveVaultsRegistry()` | 新增，写入 vaults.json |
| `migrateLegacyVault()` | 新增，检测旧版文件结构，迁移到 `vault/default/` |
| `getStatus()` | 增强：返回 `{active, vaults: [{name, label, entryCount, createdAt, isActive}], exists, unlocked, entryCount}` |
| `init(desKey, vaultName, label)` | 修改：增加 `vaultName`（默认 "default"）和 `label`（默认 "主密码库"）参数 |
| `unlock(desKey, vaultName)` | 修改：增加 `vaultName`（默认当前 active vault）参数 |
| `listVaults()` | 新增：返回所有密码库信息列表 |
| `switchVault(vaultName)` | 新增：锁定当前 vault，切换 active |
| `deleteVault(vaultName)` | 新增：删除 vault 目录和注册表条目 |
| `checkKey(vaultName, desKey)` | 新增：仅验证 Key 是否正确，返回 `{valid: true/false}` |
| `saveVault()` | 修改：使用 `activeVaultName` 定位文件路径 |

#### 迁移逻辑 `migrateLegacyVault()` 实现要点

```java
private void migrateLegacyVault() {
    Path vaultsFile = getVaultsFile();
    if (Files.exists(vaultsFile)) return; // already migrated

    Path oldVaultFile = Paths.get(storagePath, "vault", "vault.enc");
    Path oldMetaFile = Paths.get(storagePath, "vault", "vault-meta.json");
    if (!Files.exists(oldVaultFile)) return; // nothing to migrate

    // Create default directory
    Path defaultDir = getVaultDir("default");
    Files.createDirectories(defaultDir);

    // Move files
    Files.move(oldVaultFile, getVaultFile("default"));
    if (Files.exists(oldMetaFile)) {
        Files.move(oldMetaFile, getMetaFile("default"));
    }

    // Read old meta for keyCheckHash and entryCount
    String keyCheckHash = "";
    int entryCount = 0;
    // ... read from meta file ...

    // Create vaults.json
    vaultRegistry = new HashMap<>();
    VaultMeta meta = new VaultMeta("default", "主密码库", keyCheckHash);
    meta.setEntryCount(entryCount);
    vaultRegistry.put("default", meta);
    activeVaultName = "default";
    saveVaultsRegistry();
}
```

#### 错误消息改进

- `unlock()` 中 Key 不匹配：`"DES Key 不正确，请检查后重试"`（保持）
- `unlock()` 中文件不存在：`"密码库「{label}」不存在，请先初始化"`（改进）
- `init()` 中 vaultName 已存在：`"密码库名称「{label}」已存在，请使用其他名称"`（新增）
- `deleteVault()` 中删除 active vault：`"无法删除正在使用的密码库，请先切换到其他密码库"`（新增）

### 3.2 PasswordVaultController

**文件**：[PasswordVaultController.java](file:///workspace/backend/src/main/java/com/example/clip/controller/PasswordVaultController.java)

| 端点 | 方法 | 改动 |
|---|---|---|
| `GET /api/vault/status` | 增强 | 返回 `{active, vaults: [{name, label, entryCount, createdAt, isActive}], exists, unlocked, entryCount}` |
| `POST /api/vault/init` | 修改 | `body` 增加可选 `vaultName`（默认 "default"）和 `label`（默认 "主密码库"） |
| `POST /api/vault/unlock` | 修改 | `body` 增加可选 `vaultName`（默认当前 active vault 名称） |
| `GET /api/vault/vaults` | 新增 | 列出所有密码库 |
| `PUT /api/vault/vaults/active` | 新增 | 切换激活密码库，`body {vaultName: "xxx"}` |
| `DELETE /api/vault/vaults/{name}` | 新增 | 删除密码库 |
| `POST /api/vault/check-key` | 新增 | 验证 Key，`body {vaultName, desKey}`，返回 `{valid: true/false}` |

`init()` 和 `unlock()` 的 Controller 方法需要从 `body` 中读取新增的 `vaultName` 和 `label` 参数，传入 Service 对应方法。

`/status` 端点需要调用 `vaultService.listVaults()` 组装 vaults 列表返回。

---

## 四、前端改动（vault.html）

**文件**：[vault.html](file:///workspace/frontend/vault.html)

### 4.1 锁屏页重构（L250-L270）

**新增**：密码库选择器（多 vault 时显示），`<select id="lockVaultSelect">`

**HTML 改动**：

```html
<div class="lock-card">
  <!-- ... 原有 icon、title、subtitle ... -->

  <!-- 新增：密码库选择器 -->
  <div class="lock-vault-selector" id="lockVaultSelector" style="display:none; margin-bottom:12px;">
    <select class="lock-input" id="lockVaultSelect" onchange="onLockVaultChange()" style="margin-bottom:0;"></select>
  </div>

  <input type="password" class="lock-input" id="keyInput" placeholder="粘贴或输入 DES Key..." onkeydown="if(event.key==='Enter')doUnlock()">
  <button class="lock-btn" onclick="doUnlock()">解锁</button>
  <div class="lock-error" id="lockError"></div>
  <div class="lock-link">
    <span id="firstTimeHint" style="display:none;">还没有密码库？</span>
    <a id="initLink" onclick="showInitModal()" style="display:none;">初始化新密码库</a>
    <span id="noKeyHint">我忘记了 Key？</span>
    <a onclick="showForgotKeyGuide()">创建新密码库</a>
  </div>
</div>
```

**JS 改动**：

- `init()` 增强：调用 `/api/vault/status`，获取 vaults 列表，如果 vaults 数量 > 1 则渲染选择器
- `onLockVaultChange()` 新增：密码库切换时更新 subtitle 提示文字
- `doUnlock()` 改进错误处理：

```javascript
async function doUnlock() {
  const key = document.getElementById('keyInput').value.trim();
  if (!key) return;
  const vaultName = document.getElementById('lockVaultSelect')?.value || 'default';
  const errEl = document.getElementById('lockError');
  errEl.style.display = 'none';
  try {
    const res = await fetch(API + '/unlock', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({desKey: key, vaultName: vaultName})
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      errEl.textContent = data.error || '无法连接后端服务，请确认应用已启动';
      errEl.style.display = 'block';
      return;
    }
    sessionKey = key;
    currentVaultName = vaultName;
    allEntries = data.entries || [];
    filteredEntries = allEntries;
    document.getElementById('lockScreen').style.display = 'none';
    document.getElementById('vaultApp').style.display = 'flex';
    renderList();
    updateCounts();
  } catch (e) {
    errEl.textContent = '无法连接后端服务，请确认应用已启动';
    errEl.style.display = 'block';
  }
}
```

### 4.2 忘记 Key 引导

新增 `showForgotKeyGuide()` 函数，弹出小型引导模态框：

```html
<div class="modal-overlay" id="forgotKeyModal">
  <div class="modal-card" style="width:400px;">
    <div class="modal-header">忘记 DES Key</div>
    <div class="modal-body">
      <div style="padding:12px; background:#fef3c7; border:1px solid #fcd34d; border-radius:10px; font-size:12px; color:#92400e; line-height:1.7; margin-bottom:16px;">
        DES Key 丢失后<strong>无法恢复</strong>旧密码库数据。<br>
        但你可以创建新密码库继续使用，旧密码库数据将保留。<br>
        如果日后记起旧 Key，可以切换回来读取。
      </div>
      <div style="font-size:13px; color:var(--fg-secondary); line-height:1.6;">
        当前密码库：<strong id="forgotKeyVaultName">-</strong><br>
        创建新密码库后，旧密码库文件不会删除。
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal('forgotKeyModal')">取消</button>
      <button class="btn-primary" onclick="closeModal('forgotKeyModal'); showInitModal()">创建新密码库</button>
    </div>
  </div>
</div>
```

### 4.3 初始化模态框重设计（L556-L576）

替换现有 `initModal`，增加密码库名称输入、Key 生成引导、保存提示：

```html
<div class="modal-overlay" id="initModal">
  <div class="modal-card" style="width:440px;">
    <div class="modal-header">初始化密码库</div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">密码库名称</label>
        <input type="text" class="form-input" id="initVaultName" placeholder="如：主密码库、工作密码库" value="主密码库">
      </div>

      <div style="padding:12px 14px; background:#fef3c7; border:1px solid #fcd34d; border-radius:10px; font-size:12px; color:#92400e; line-height:1.7; margin-bottom:16px;">
        <strong>重要提示</strong><br>
        DES Key 是密码库的唯一解密凭证，<strong>丢失后无法恢复</strong>。<br>
        请务必在生成后立即保存到安全位置。
      </div>

      <div class="form-group">
        <label class="form-label">DES Key</label>
        <div style="display:flex; gap:8px; margin-bottom:8px;">
          <input type="text" class="form-input" id="initKeyInput" placeholder="自定义 Key 或点击自动生成" style="flex:1;">
          <button class="btn-secondary" onclick="generateInitKey()" style="white-space:nowrap;">自动生成</button>
        </div>
        <div style="font-size:11px; color:var(--fg-muted);">支持自定义 Base64 字符串或自动生成</div>
      </div>

      <div id="initKeySaveHint" style="display:none; padding:12px; background:#dcfce7; border:1px solid #86efac; border-radius:10px; margin-top:8px;">
        <div style="font-size:12px; color:#166534; font-weight:500; margin-bottom:6px;">Key 已生成</div>
        <div style="font-size:11px; color:#15803d; line-height:1.5; margin-bottom:8px;">
          请立即复制并保存此 Key。丢失后密码库数据将无法恢复。
        </div>
        <button class="btn-secondary" onclick="copyInitKey()" style="font-size:11px; padding:5px 12px;">复制 Key</button>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal('initModal')">取消</button>
      <button class="btn-primary" onclick="doInit()">创建密码库</button>
    </div>
  </div>
</div>
```

**JS 改动**：
- `generateInitKey()` → 调用 `generateKeyLocal()` 填入，显示 `#initKeySaveHint`
- 新增 `copyInitKey()` → 复制 `#initKeyInput` 值，toast "请保存到安全位置"
- `doInit()` → 读取 `initVaultName` 和 `initKeyInput`，调用 `/api/vault/init` 传 `{desKey, vaultName, label}`

### 4.4 侧边栏新增「密码库管理」入口

在「DES Key 管理」上方（L308-L311 之前）插入：

```html
<div class="sidebar-item" onclick="showVaultManager()">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
  密码库管理
</div>
```

### 4.5 新增密码库管理模态框

在 `auditModal` 之后、`initModal` 之前插入：

```html
<div class="modal-overlay" id="vaultManagerModal">
  <div class="modal-card" style="width:500px; max-height:70vh; display:flex; flex-direction:column;">
    <div class="modal-header">密码库管理</div>
    <div class="modal-body" style="overflow-y:auto; flex:1;">
      <div id="vaultManagerList"></div>
      <div style="margin-top:16px; padding-top:16px; border-top:1px solid var(--border);">
        <button class="btn-primary" onclick="closeModal('vaultManagerModal'); showInitModal()" style="width:100%;">+ 新建密码库</button>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal('vaultManagerModal')">关闭</button>
    </div>
  </div>
</div>
```

**JS 逻辑**：
- `showVaultManager()` → 调用 `/api/vault/vaults` 获取列表，渲染每个 vault 卡片
- 每个 vault 卡片：名称、标签、条目数、创建时间、当前激活标识
- 非当前 vault 显示「切换到此密码库」按钮 → 调用 `PUT /api/vault/vaults/active`
- 非当前 vault 显示「删除」按钮 → 确认弹窗 → 调用 `DELETE /api/vault/vaults/{name}`
- 切换后自动返回锁屏页，提示"已切换到「{label}」，请输入 DES Key 解锁"

---

## 五、改动文件清单

| 文件 | 改动内容 |
|---|---|
| `backend/.../PasswordVaultService.java` | 多 vault 支持（路径参数化、vaults.json 注册表、迁移、listVaults/switchVault/deleteVault/checkKey）；init/unlock 增加 vaultName 参数；新增 VaultMeta 内部类 |
| `backend/.../PasswordVaultController.java` | 新增 4 个端点（GET /vaults、PUT /vaults/active、DELETE /vaults/{name}、POST /check-key）；修改 init/unlock/status 参数和返回值 |
| `frontend/vault.html` | 锁屏页增加密码库选择器；初始化模态框重设计（名称+Key自定义/生成+保存提示）；新增密码库管理模态框；新增忘记 Key 引导模态框；doUnlock 错误处理改进；侧边栏新增「密码库管理」入口 |

**不涉及的文件**：DesEncryptionUtil.java、PasswordEntry.java、VaultData.java、浏览器插件文件、导入功能

---

## 六、交互流程

### 6.1 首次使用

```
锁屏页 → 点击「初始化新密码库」
  → 初始化模态框：输入密码库名称 + 自动生成/自定义 Key
  → 显示「Key 已生成，请保存到安全位置」+ 复制按钮
  → 点击「创建密码库」→ 解锁成功，进入主界面
```

### 6.2 忘记 Key

```
锁屏页 → 点击「我忘记了 Key」
  → 说明弹窗：解释旧数据保留，可创建新密码库
  → 点击「创建新密码库」→ 进入初始化流程
  → 旧密码库文件保留，日后可通过「密码库管理」切换回来
```

### 6.3 多密码库切换

```
已解锁密码库 → 侧边栏「密码库管理」
  → 看到所有密码库列表（当前激活标记）
  → 点击「切换到此密码库」→ 确认弹窗
  → 返回锁屏页，选择器已切换到目标密码库
  → 输入对应 Key → 解锁
```

---

## 七、验证步骤

1. **错误提示**：后端未启动 → "无法连接后端服务"；错误 Key → "DES Key 不正确"；正确 Key → 正常解锁
2. **Key 生成**：自动生成 → 填入输入框 + 显示保存提示；复制 Key → toast "请保存到安全位置"
3. **多密码库**：创建多个密码库 → 切换 → 来回解锁读取不同数据 → 删除非当前密码库
4. **向后兼容**：旧版 vault.enc 在 vault/ 根目录 → 升级后自动迁移到 vault/default/ → 正常解锁