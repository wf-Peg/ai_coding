# 密码管理器深度集成设计方案

## 一、市场分析与设计借鉴

### 1.1 五大密码管理器核心设计提炼

| 产品 | 借鉴点 | 本方案采纳方式 |
|------|--------|---------------|
| **1Password** | 分类体系（Logins/Cards/Notes/Identities）、Watchtower 安全审计 | 采纳分类侧边栏 + 密码强度审计 |
| **Bitwarden** | 开源本地优先、Folder+Collection 组织、密码生成器 | 采纳文件夹组织 + 密码生成器 |
| **KeePass** | 纯本地文件存储、多因子密钥、Global Auto-Type | 采纳本地加密文件存储模式 |
| **LastPass** | Security Dashboard、弱密码/重复密码检测 | 采纳安全仪表盘概念 |
| **Proton Pass** | 极简瑞士设计、Alias 别名管理 | 采纳极简 UI + 别名字段 |

### 1.2 核心设计原则

1. **本地优先**：密码数据 DES 加密后存储在本地 `clip-storage/vault/` 目录，与现有 FileStorageService 体系一致
2. **零知识**：DES Key 不存储在服务端，仅用户持有；后端只处理加密/解密运算，不持久化密钥
3. **深度集成**：复用现有主题系统（Notion/Obsidian 风格）、SPA 路由、Electron IPC 通道
4. **DES 加密**：按用户要求使用 DES 算法加密密码文件，用户输入 Key 解密

---

## 二、架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────┐
│  Electron 主进程 (main.js)                           │
│  ├── 托盘菜单新增「密码管理」入口                       │
│  ├── IPC: vault-unlock / vault-lock / vault-generate-key │
│  └── 启动时 vault 默认锁定                             │
├─────────────────────────────────────────────────────┤
│  前端 (vault.html)                                    │
│  ├── 锁屏页：输入 DES Key 解锁                         │
│  ├── 密码列表：分类侧边栏 + 卡片列表 + 搜索             │
│  ├── 密码详情：查看/编辑/复制/删除                      │
│  ├── 密码生成器：长度/字符集/排除符号                   │
│  ├── DES Key 管理：生成/导入/导出                      │
│  └── 安全审计：弱密码/重复密码检测                      │
├─────────────────────────────────────────────────────┤
│  Spring Boot 后端                                     │
│  ├── PasswordVaultController (/api/vault/*)          │
│  ├── PasswordVaultService (CRUD + 加解密)             │
│  ├── DesEncryptionUtil (DES 加解密工具)                │
│  └── FileStorageService (复用存储路径)                │
├─────────────────────────────────────────────────────┤
│  文件存储                                             │
│  clip-storage/vault/                                  │
│  ├── vault.enc        ← DES 加密的密码库文件            │
│  └── vault-meta.json  ← 非敏感元数据（盐值、版本等）     │
└─────────────────────────────────────────────────────┘
```

### 2.2 DES 加密流程

```
用户生成 DES Key
    ↓
后端生成 8 字节随机密钥 (SecureRandom)
    ↓
Base64 编码 → 展示给用户保存
    ↓
用户输入 DES Key → 后端 Base64 解码
    ↓
DES/ECB/PKCS5Padding 加密密码库 JSON
    ↓
写入 vault.enc
    ↓
解锁时：用户输入 Key → DES 解密 → 内存中返回明文 JSON
```

> **说明**：按用户明确要求使用 DES 算法。DES 密钥为 64 位（8 字节，其中 8 位为校验位，有效密钥 56 位）。用户通过生成入口获取 Base64 编码的 Key，输入后解锁。

### 2.3 数据模型

```java
// PasswordEntry.java — 单条密码记录
public class PasswordEntry {
    private Long id;
    private String title;          // 名称（如 "GitHub 账号"）
    private String category;       // 分类：login / card / note / identity
    private String username;       // 用户名
    private String password;       // 密码（加密存储）
    private String url;            // 网址
    private String notes;          // 备注
    private String alias;          // 别名邮箱（借鉴 Proton Pass）
    private List<String> tags;     // 标签
    private String iconColor;      // 卡片图标颜色
    private Long createdAt;        // 创建时间戳
    private Long updatedAt;        // 更新时间戳
    private boolean favorite;      // 收藏
}

// VaultData.java — 整个密码库
public class VaultData {
    private Long version;
    private List<PasswordEntry> entries;
    private Long lastModified;
}
```

### 2.4 密码库文件结构

**vault.enc**（DES 加密后的二进制文件）：
```
[8字节 IV/Header] [DES 加密的 JSON 内容]
```

解密后的 JSON 内容：
```json
{
  "version": 1,
  "lastModified": 1719705600000,
  "entries": [
    {
      "id": 1,
      "title": "GitHub",
      "category": "login",
      "username": "user@example.com",
      "password": "p@ssw0rd123",
      "url": "https://github.com",
      "notes": "主力开发账号",
      "tags": ["开发", "重要"],
      "iconColor": "#24292e",
      "favorite": true,
      "createdAt": 1719705600000,
      "updatedAt": 1719705600000
    }
  ]
}
```

**vault-meta.json**（非敏感元数据，不加密）：
```json
{
  "version": 1,
  "algorithm": "DES/ECB/PKCS5Padding",
  "keyCheckHash": "a1b2c3d4...",
  "createdAt": 1719705600000,
  "entryCount": 0
}
```

> `keyCheckHash`：DES Key 的 SHA-256 哈希前 8 位，用于验证用户输入的 Key 是否正确（不存储 Key 本身）。

---

## 三、后端实现

### 3.1 新增文件清单

| 文件路径 | 说明 |
|---------|------|
| `backend/.../controller/PasswordVaultController.java` | REST API 控制器 |
| `backend/.../service/PasswordVaultService.java` | 密码库业务逻辑 |
| `backend/.../util/DesEncryptionUtil.java` | DES 加解密工具类 |
| `backend/.../dto/VaultRequest.java` | 请求 DTO |
| `backend/.../dto/VaultResponse.java` | 响应 DTO |
| `backend/.../model/PasswordEntry.java` | 密码条目实体 |
| `backend/.../model/VaultData.java` | 密码库实体 |

### 3.2 DesEncryptionUtil.java

```java
package com.example.clip.util;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.DESKeySpec;
import java.security.SecureRandom;
import java.util.Base64;

public class DesEncryptionUtil {

    private static final String ALGORITHM = "DES/ECB/PKCS5Padding";
    private static final String KEY_ALGORITHM = "DES";

    /**
     * 生成随机 DES 密钥（8 字节）
     * @return Base64 编码的密钥字符串
     */
    public static String generateKey() {
        SecureRandom random = new SecureRandom();
        byte[] keyBytes = new byte[8];
        random.nextBytes(keyBytes);
        return Base64.getEncoder().encodeToString(keyBytes);
    }

    /**
     * DES 加密
     * @param plaintext 明文字符串
     * @param keyBase64 Base64 编码的 DES 密钥
     * @return Base64 编码的密文
     */
    public static String encrypt(String plaintext, String keyBase64) {
        try {
            DESKeySpec desKey = new DESKeySpec(Base64.getDecoder().decode(keyBase64));
            SecretKeyFactory keyFactory = SecretKeyFactory.getInstance(KEY_ALGORITHM);
            SecretKey secureKey = keyFactory.generateSecret(desKey);
            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.ENCRYPT_MODE, secureKey);
            byte[] encrypted = cipher.doFinal(plaintext.getBytes("UTF-8"));
            return Base64.getEncoder().encodeToString(encrypted);
        } catch (Exception e) {
            throw new RuntimeException("DES 加密失败", e);
        }
    }

    /**
     * DES 解密
     * @param ciphertextBase64 Base64 编码的密文
     * @param keyBase64 Base64 编码的 DES 密钥
     * @return 明文字符串
     */
    public static String decrypt(String ciphertextBase64, String keyBase64) {
        try {
            DESKeySpec desKey = new DESKeySpec(Base64.getDecoder().decode(keyBase64));
            SecretKeyFactory keyFactory = SecretKeyFactory.getInstance(KEY_ALGORITHM);
            SecretKey secureKey = keyFactory.generateSecret(desKey);
            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.DECRYPT_MODE, secureKey);
            byte[] decrypted = cipher.doFinal(Base64.getDecoder().decode(ciphertextBase64));
            return new String(decrypted, "UTF-8");
        } catch (Exception e) {
            throw new RuntimeException("DES 解密失败，请检查 Key 是否正确", e);
        }
    }

    /**
     * 验证 Key 是否正确（通过 Key 的 SHA-256 哈希前 8 位比对）
     */
    public static String getKeyCheckHash(String keyBase64) {
        try {
            java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(keyBase64.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 4; i++) {
                sb.append(String.format("%02x", hash[i]));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new RuntimeException("生成 Key 校验哈希失败", e);
        }
    }
}
```

### 3.3 PasswordVaultController.java — REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/vault/generate-key` | 生成随机 DES Key（返回 Base64 字符串） |
| POST | `/api/vault/init` | 初始化密码库（传入 Key，创建空加密文件） |
| POST | `/api/vault/unlock` | 解锁密码库（传入 Key，返回解密后的所有条目） |
| POST | `/api/vault/lock` | 锁定密码库（清除内存中的解密数据） |
| GET | `/api/vault/status` | 查询密码库状态（是否存在、是否已解锁） |
| POST | `/api/vault/entry` | 新增密码条目 |
| PUT | `/api/vault/entry/{id}` | 更新密码条目 |
| DELETE | `/api/vault/entry/{id}` | 删除密码条目 |
| GET | `/api/vault/search?keyword=` | 搜索密码条目 |
| GET | `/api/vault/audit` | 安全审计（弱密码、重复密码检测） |
| POST | `/api/vault/generate-password` | 生成随机密码（可选长度/字符集） |

### 3.4 PasswordVaultService.java 核心逻辑

```java
@Service
public class PasswordVaultService {

    @Value("${clip.storage.path:./clip-storage}")
    private String storagePath;

    private VaultData cachedVault;  // 解锁后缓存在内存中
    private boolean isUnlocked = false;

    /**
     * 解锁：读取 vault.enc → DES 解密 → 反序列化为 VaultData → 缓存
     */
    public VaultData unlock(String desKey) {
        Path encPath = getVaultPath("vault.enc");
        if (!Files.exists(encPath)) {
            throw new RuntimeException("密码库不存在，请先初始化");
        }
        String encrypted = Files.readString(encPath);
        String json = DesEncryptionUtil.decrypt(encrypted, desKey);
        cachedVault = objectMapper.readValue(json, VaultData.class);
        isUnlocked = true;
        return cachedVault;
    }

    /**
     * 保存：序列化 VaultData → DES 加密 → 写入 vault.enc
     */
    public void saveVault(String desKey) {
        String json = objectMapper.writeValueAsString(cachedVault);
        String encrypted = DesEncryptionUtil.encrypt(json, desKey);
        Files.writeString(getVaultPath("vault.enc"), encrypted);
    }

    /**
     * 锁定：清除内存缓存
     */
    public void lock() {
        cachedVault = null;
        isUnlocked = false;
    }
}
```

---

## 四、前端实现

### 4.1 新增文件

| 文件路径 | 说明 |
|---------|------|
| `frontend/vault.html` | 密码管理器主页面 |
| `frontend/vault.js` | 密码管理器交互逻辑 |

### 4.2 页面结构（vault.html）

```
┌──────────────────────────────────────────────────────┐
│  锁屏状态                                             │
│  ┌────────────────────────────────────┐              │
│  │         🔒 锁图标                   │              │
│  │     密码库已锁定                    │              │
│  │  ┌──────────────────┐  [解锁]      │              │
│  │  │ 输入 DES Key...  │              │              │
│  │  └──────────────────┘              │              │
│  │  还没有 Key？ [生成新 Key]          │              │
│  └────────────────────────────────────┘              │
├──────────────────────────────────────────────────────┤
│  解锁状态                                             │
│  ┌─────────┬──────────────────┬──────────────────┐  │
│  │ 侧边栏   │    密码列表       │    详情面板       │  │
│  │         │                  │                  │  │
│  │ 全部(12) │ ┌──────────────┐ │  标题: GitHub    │  │
│  │ 登录(8)  │ │ 🔵 GitHub    │ │  用户名: user@.. │  │
│  │ 卡片(2)  │ │ user@examp.. │ │  密码: ●●●●● [复] │  │
│  │ 备注(1)  │ └──────────────┘ │  网址: github.com│  │
│  │ 身份(1)  │ ┌──────────────┐ │  备注: 主力账号   │  │
│  │         │ │ 🟢 Gmail     │ │  标签: 开发 重要  │  │
│  │ ⭐ 收藏   │ │ user@gmail.. │ │                  │  │
│  │ 🔍 搜索   │ └──────────────┘ │  [编辑] [删除]   │  │
│  │         │                  │                  │  │
│  │ + 新增   │                  │                  │  │
│  │ ⚙ Key管理│                  │                  │  │
│  │ 📊 安全  │                  │                  │  │
│  └─────────┴──────────────────┴──────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### 4.3 SPA 路由集成

在 `index.html` 的路由中新增 `vault` 视图：

```javascript
const VIEW_IFRAME = {
  topic: 'topic.html',
  settings: 'settings.html',
  vault: 'vault.html'  // 新增
};
```

导航栏新增「密码」按钮（锁图标），位于「话题」和「设置」之间。

### 4.4 样式设计（匹配现有 Notion/Obsidian 风格）

```css
/* vault.html 内联样式，复用 theme-notion.css 变量 */

/* 锁屏页 */
.vault-lock-screen {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    height: 100vh; background: var(--bg);
}
.vault-lock-icon {
    width: 64px; height: 64px;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    border-radius: 20px;
    display: flex; align-items: center; justify-content: center;
    margin-bottom: 24px;
    box-shadow: 0 8px 32px rgba(99, 102, 241, 0.3);
}
.vault-lock-icon svg { width: 32px; height: 32px; color: white; }

/* 密码列表卡片 */
.vault-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 14px 16px;
    cursor: pointer;
    transition: var(--transition);
    display: flex; align-items: center; gap: 12px;
}
.vault-card:hover {
    background: var(--card-hover);
    border-color: var(--primary);
}
.vault-card-icon {
    width: 36px; height: 36px; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-size: 16px; color: white; flex-shrink: 0;
}

/* 侧边栏分类 */
.vault-sidebar {
    width: 200px;
    border-right: 1px solid var(--border);
    padding: 12px 8px;
}
.vault-category {
    padding: 8px 12px; border-radius: 6px;
    cursor: pointer; font-size: 13px;
    color: var(--fg-secondary);
    transition: var(--transition);
    display: flex; align-items: center; gap: 8px;
}
.vault-category:hover { background: var(--card-hover); }
.vault-category.active {
    background: var(--primary-glow);
    color: var(--primary); font-weight: 500;
}

/* 详情面板 */
.vault-detail {
    flex: 1; padding: 24px;
    border-left: 1px solid var(--border);
}
.vault-field {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 0; border-bottom: 1px solid var(--border);
}
.vault-field-label {
    width: 80px; font-size: 12px;
    color: var(--fg-secondary); flex-shrink: 0;
}
.vault-field-value {
    font-size: 14px; color: var(--fg);
    flex: 1; font-family: 'SF Mono', monospace;
}
.vault-copy-btn {
    padding: 4px 10px; border: 1px solid var(--border);
    border-radius: 4px; background: var(--card);
    cursor: pointer; font-size: 11px;
    color: var(--fg-secondary);
    transition: var(--transition);
}
.vault-copy-btn:hover { border-color: var(--primary); color: var(--primary); }
```

### 4.5 密码生成器 UI

```
┌──────────────────────────────────┐
│  密码生成器                       │
│                                  │
│  ┌────────────────────┐ [复制]   │
│  │ xK9#mP2$vQ7nR4    │          │
│  └────────────────────┘          │
│                                  │
│  长度: ──────●────── 16          │
│                                  │
│  ☑ 大写字母 (A-Z)                │
│  ☑ 小写字母 (a-z)                │
│  ☑ 数字 (0-9)                    │
│  ☑ 特殊符号 (!@#$%)              │
│  ☐ 排除易混淆字符 (0O1lI)        │
│                                  │
│  强度: ████████████ 很强          │
│                                  │
│  [重新生成]  [使用此密码]         │
└──────────────────────────────────┘
```

### 4.6 DES Key 管理面板

```
┌──────────────────────────────────┐
│  DES Key 管理                     │
│                                  │
│  ┌────────────────────┐ [复制]   │
│  │ Base64 Key 字符串   │ [显示/隐藏]│
│  └────────────────────┘          │
│                                  │
│  [生成新 Key]                    │
│                                  │
│  ⚠ 重要提示：                     │
│  • Key 是唯一解密凭证，丢失无法恢复 │
│  • 请将 Key 安全保存到离线位置     │
│  • 生成新 Key 需要重新加密所有密码  │
│                                  │
│  Key 状态: ✅ 已验证              │
│  创建时间: 2026-06-30 12:00       │
│  密码条目: 12 条                  │
└──────────────────────────────────┘
```

### 4.7 安全审计面板

```
┌──────────────────────────────────┐
│  安全审计                         │
│                                  │
│  🟢 密码强度                      │
│  ┌────────────────────────────┐  │
│  │ 强密码: 8 条 (67%)          │  │
│  │ 中等: 3 条 (25%)            │  │
│  │ 弱密码: 1 条 (8%) ⚠         │  │
│  └────────────────────────────┘  │
│                                  │
│  🔴 重复密码                      │
│  ┌────────────────────────────┐  │
│  │ 发现 2 组重复密码            │  │
│  │ • GitHub = GitLab           │  │
│  │ • Gmail = Outlook           │  │
│  └────────────────────────────┘  │
│                                  │
│  📅 过期密码                      │
│  ┌────────────────────────────┐  │
│  │ 超过 180 天未更新: 3 条      │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

---

## 五、Electron 集成

### 5.1 导航栏新增入口

在 `index.html` 标题栏导航中新增「密码」按钮：

```html
<button class="nav-btn" data-view="vault" title="密码管理">
    <svg viewBox="0 0 24 24" ...>
        <rect x="3" y="11" width="18" height="11" rx="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
    <span>密码</span>
</button>
```

### 5.2 托盘菜单新增

```javascript
// main.js createTray() 中
const contextMenu = Menu.buildFromTemplate([
  { label: '显示主窗口', click: () => { ... } },
  { label: '密码管理', click: () => {
      // 切换到 vault 视图
      if (mainWindow) mainWindow.webContents.send('navigate', 'vault');
  }},
  { type: 'separator' },
  { label: '退出', click: () => app.quit() }
]);
```

### 5.3 自动锁定

- 应用最小化到托盘时自动锁定密码库（调用 `/api/vault/lock`）
- 闲置 5 分钟自动锁定（可配置）
- 窗口切换失焦时不锁定（避免频繁解锁）

---

## 六、完整文件清单

### 6.1 后端新增（7 个文件）

| 文件 | 行数估算 | 说明 |
|------|---------|------|
| `backend/.../util/DesEncryptionUtil.java` | ~80 | DES 加解密 + Key 生成 + 校验 |
| `backend/.../model/PasswordEntry.java` | ~60 | 密码条目实体 |
| `backend/.../model/VaultData.java` | ~30 | 密码库实体 |
| `backend/.../dto/VaultRequest.java` | ~40 | 请求 DTO |
| `backend/.../dto/VaultResponse.java` | ~30 | 响应 DTO |
| `backend/.../service/PasswordVaultService.java` | ~250 | 核心业务逻辑 |
| `backend/.../controller/PasswordVaultController.java` | ~120 | REST API |

### 6.2 前端新增（2 个文件）

| 文件 | 行数估算 | 说明 |
|------|---------|------|
| `frontend/vault.html` | ~400 | 页面 HTML + CSS |
| `frontend/vault.js` | ~350 | 交互逻辑 |

### 6.3 现有文件修改（2 个文件）

| 文件 | 改动 |
|------|------|
| `frontend/index.html` | 导航栏新增「密码」按钮 + SPA 路由新增 vault 视图 |
| `electron/main.js` | 托盘菜单新增「密码管理」入口 + 自动锁定逻辑 |

---

## 七、验证步骤

1. 启动应用 → 导航栏出现「密码」入口
2. 点击进入 → 显示锁屏页
3. 点击「生成新 Key」→ 后端返回 Base64 Key → 展示给用户
4. 输入 Key → 点击「解锁」→ 密码库初始化成功，显示空列表
5. 新增密码条目 → 填写表单 → 保存 → DES 加密写入 vault.enc
6. 重新打开应用 → 输入相同 Key → 解锁 → 看到已保存的条目
7. 输入错误 Key → 解锁失败，提示「Key 不正确」
8. 密码生成器 → 调整参数 → 生成密码 → 使用
9. 安全审计 → 检测到弱密码/重复密码 → 显示警告
10. 最小化到托盘 → 自动锁定 → 恢复后需重新输入 Key
