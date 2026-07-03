# 密码库导入流程修复 + Bug 全面排查 — 实现计划

## 摘要

修复密码库（vault.html）导入向导的 3 个严重问题：按钮样式缺失、步骤跳转逻辑错误、删除功能无响应。同时排查并修复 5 个附带问题：后端硬编码标签、HTTP 响应未检查、console.error 残留、状态清理不完整，以及按钮样式统一。

---

## 当前状态分析

### 问题 1（严重）：`modal-submit` CSS 类完全缺失

**文件**：`frontend/vault.html` 第 583–585 行

"下一步"、"确认导入"、"完成" 三个按钮均使用 `class="modal-submit"`，但 CSS 中**没有任何 `.modal-submit` 样式定义**。按钮渲染为浏览器默认样式，与产品 Notion 风格格格不入。

### 问题 2（严重）：`importNext()` 跳转方向错误

**文件**：`frontend/vault.html` 第 1559 行

```javascript
function importNext() { showImportStep(1); }  // BUG：应该跳步骤 3
```

步骤 2 点击"下一步"应该跳转到步骤 3（结果确认页），但实际跳回步骤 1，导致 CSV 解析结果丢失，用户需重新选文件。

### 问题 3（严重）：步骤 2 同时显示"下一步"和"确认导入"两个按钮

**文件**：`frontend/vault.html` 第 1343–1344 行

```javascript
document.getElementById('importNextBtn').style.display = step === 2 ? 'inline-block' : 'none';
document.getElementById('importDoBtn').style.display = step === 2 ? 'inline-block' : 'none';
```

步骤 2 同时显示两个按钮，且"下一步"跳回步骤 1，形成死循环 UX。

### 问题 4（严重）：`deleteEntry()` 未检查 HTTP 响应

**文件**：`frontend/vault.html` 第 1102 行

```javascript
await fetch(API + '/entry/' + entryId, {method: 'DELETE'});
allEntries = allEntries.filter(e => e.id !== entryId);  // 不检查 res.ok 直接更新 UI
```

后端返回错误时前端仍移除条目，造成数据不一致。

### 问题 5（中等）：后端导入时硬编码 "chrome" 标签

**文件**：`backend/.../PasswordVaultService.java` 第 924 行

```java
if (!tags.contains("chrome")) tags.add("chrome");
```

无论用户选择哪个来源（Chrome/Bitwarden/1Password/LastPass），标签始终被标记为 `"chrome"`。

### 问题 6（中等）：`deleteVaultAction` / `switchToVault` 未检查 `res.ok`

**文件**：`frontend/vault.html` 第 1278、1242 行

虽然有 `data.error` 检查，但当 HTTP 非 2xx 且未返回 JSON 时，`res.json()` 抛异常只显示通用错误。

### 问题 7（低）：`console.error` 残留 + `closeImportModal()` 清理不完整

**文件**：`frontend/vault.html` 第 780、1571、1330–1333 行

---

## 变更计划

### 变更 1：新增 `modal-submit` CSS 样式（vault.html）

在 `btn-secondary` 样式之后（约第 220 行），新增：

```css
.modal-submit {
  padding: 8px 20px; border: none; border-radius: 8px;
  background: var(--vault-purple); color: #fff;
  font-size: 13px; font-weight: 500; cursor: pointer;
  font-family: inherit; transition: all 0.15s;
}
.modal-submit:hover { opacity: 0.9; }
```

### 变更 2：修复导入流程步骤逻辑（vault.html）

**a) 步骤 2 不显示"下一步"按钮**（第 1343 行）：
```javascript
document.getElementById('importNextBtn').style.display = 'none';  // 步骤 2 不显示"下一步"
```

**b) 修复 `importNext()` 跳转**（第 1559 行）：
```javascript
function importNext() { showImportStep(3); }  // 从步骤 2 跳转到步骤 3
```

**c) 流程逻辑变为**：
- 步骤 1：选择 CSV 文件 → 自动跳转步骤 2
- 步骤 2：预览 + 勾选条目 → "上一步"回到步骤 1 / "确认导入"执行导入 → 跳转步骤 3
- 步骤 3：显示结果 → "完成"关闭弹窗并刷新列表

### 变更 3：修复 `deleteEntry()` 响应检查（vault.html）

```javascript
async function deleteEntry(entryId) {
  const ok = await showConfirmDialog('删除密码条目', '确认删除此密码条目？此操作不可恢复。', true);
  if (!ok) return;
  try {
    const res = await fetch(API + '/entry/' + entryId, {method: 'DELETE'});
    const data = await res.json();
    if (!res.ok || data.error) { showToast(data.error || '删除失败'); return; }
    allEntries = allEntries.filter(e => e.id !== entryId);
    if (selectedEntry && selectedEntry.id === entryId) selectedEntry = null;
    applyFilter();
    updateCounts();
    renderDetail();
    showToast('已删除');
  } catch (e) { showToast('删除失败'); }
}
```

### 变更 4：修复 `deleteVaultAction` / `switchToVault` 响应检查（vault.html）

统一在 `data.error` 之前添加 `!res.ok` 检查：

```javascript
if (!res.ok || data.error) { showToast(data.error || '操作失败'); return; }
```

### 变更 5：修复后端硬编码 "chrome" 标签（PasswordVaultService.java）

第 923–924 行改为：
```java
if (!tags.contains("imported")) tags.add("imported");
// 删除 `if (!tags.contains("chrome")) tags.add("chrome");` 行
```

### 变更 6：清理 `console.error`（vault.html）

- 第 780 行：`console.error('Status check failed', e)` → 删除（init 中的静默失败）
- 第 1571 行：`console.error('refresh failed', e)` → 删除（refreshEntries 中的静默失败）

### 变更 7：修复 `closeImportModal()` 状态清理（vault.html）

```javascript
function closeImportModal() {
  closeModal('importModal');
  importState = { step: 1, source: 'chrome', parsed: [], existing: [], result: null };
}
```

---

## 变更涉及文件

| 文件 | 改动 |
|------|------|
| `frontend/vault.html` | CSS：新增 `.modal-submit` 样式；JS：修复 importNext() 跳转 + 隐藏 importNextBtn + 修复 deleteEntry/deleteVaultAction/switchToVault 响应检查 + 清理 console.error + 修复 closeImportModal 清理 |
| `backend/.../PasswordVaultService.java` | 删除硬编码 "chrome" 标签行 |

---

## 验证步骤

1. 导入密码 → 选择 CSV 文件 → 步骤 2 预览 → 确认只显示"上一步"和"确认导入"两个按钮 → 样式为紫色圆角按钮
2. 步骤 2 点击"确认导入" → 跳转步骤 3 显示结果 → "完成"按钮样式正确
3. 删除密码条目 → 确认弹窗 → 条目从列表消失
4. 密码库管理 → 切换密码库 → 弹窗确认 → 切换到锁屏
5. 密码库管理 → 删除密码库 → 弹窗确认 → 删除成功
6. 导入 CSV（Bitwarden 格式）→ 检查标签为 "imported" 而非 "chrome"