# 宠物图标：AI生成默认图 + 六动作上传改造

## 一、概要

1. 用 AI 生成 4 个 IP 角色 × 6 个动作 = 24 张默认图标（128×128，宫崎骏粗线条手绘风）
2. 将设置页的单文件上传改为六动作分别上传，支持 PNG 上传（≤2MB），内部按 `<img>` 显示

---

## 二、当前状态分析

### 当前配置结构（localStorage `cut_shelter_mascot_v1`）
- `iconType`: `'preset'` | `'upload'`
- `iconId`: 预设 ID 或 `upload-{timestamp}`
- `iconSvg`: 预设的 SVG 字符串
- `iconDataUrl`: 单张上传图片的 base64
- `action`: 当前动作（run/wave/jump/think/sleep/celebrate）

### 当前显示逻辑
- `editor.js` `applyMascotPreference()`: 根据 `config.iconType` 判断，upload 则显示 `<img>`，preset 则显示 SVG
- `settings.js` `renderMascotPreview()`: 上传时显示单张图片，预设时显示 buildMascotSvg

### 关键文件
- `frontend/js/settings.js` — 配置管理、UI渲染、上传处理
- `frontend/js/editor.js` — 宠物按钮状态应用
- `frontend/settings.html` — 设置页 UI（第 677-720 行）
- `frontend/editor.html` — 底部宠物按钮默认 SVG
- `frontend/styles/editor.css` — 宠物按钮动画（第 1281-1311 行）

---

## 三、具体改动

### Step 1：AI 生成 24 张默认图标

**目标目录**：`frontend/assets/mascot/{character_id}/{action}.png`

**4 个角色（对应 prompt 中的主体名）**：

| ID | 主体名 | 提示词主体描述 |
|----|--------|--------------|
| robot-blue | 机器人 | 主体：机器人（可爱的卡通机器人）； |
| pikachu-yellow | 皮卡丘 | 主体：皮卡丘（动漫IP的黄色电气鼠）； |
| turtle-green | 小乌龟 | 主体：小乌龟（可爱的绿色小乌龟）； |
| luoxiaohei | 罗小黑 | 主体：罗小黑（动漫IP的黑猫）； |

**6 个动作**：奔跑、挥手、跳跃、思考、打盹、庆祝

**提示词模板（适配用户要求的精确格式）**：
```
要求：生成透明背景 PNG / SVG，每张独立 128×128 图标，大小不超过2M，生成的图片名字拼接为{主体名}_{动作名}；
主体：{主体描述}；
生成图单个动作的图片：{动作名}；
风格：宫崎骏、粗线条、手绘风、透明背景；
```

**生成方式**：使用 `GenerateImage` 工具，每张图片单独生成，逐个保存到 `frontend/assets/mascot/` 目录。
- 图片大小预设：`square_hd`（1024×1024），生成后手动裁剪为 128×128 区域（或直接用原图，由 GenerateImage 控制）
- 实际生成时 prompt 填写示例（以 robot-blue 的 run 为例）：
  ```
  要求：生成透明背景 PNG / SVG，每张独立 128×128 图标，大小不超过2M，生成的图片名字拼接为robot_blue_run；
  主体：机器人（可爱的卡通机器人）；
  生成图单个动作的图片：奔跑；
  风格：宫崎骏、粗线条、手绘风、透明背景；
  ```

**产物清单**（24 个文件）：
- `frontend/assets/mascot/robot-blue/run.png`
- `frontend/assets/mascot/robot-blue/wave.png`
- `frontend/assets/mascot/robot-blue/jump.png`
- `frontend/assets/mascot/robot-blue/think.png`
- `frontend/assets/mascot/robot-blue/sleep.png`
- `frontend/assets/mascot/robot-blue/celebrate.png`
- `frontend/assets/mascot/pikachu-yellow/run.png`
- ...（其他 3 个角色同理，各 6 张）

### Step 2：更新配置结构（settings.js）

**改动点**：
1. 新增 `MASCOT_ACTIONS` 常量数组 `['run', 'wave', 'jump', 'think', 'sleep', 'celebrate']`
2. 将 `iconDataUrl: ''` 改为 `iconDataUrls: { run: '', wave: '', jump: '', think: '', sleep: '', celebrate: '' }`
3. 新增 `iconType` 值 `'preset-images'` 表示使用生成的默认图片
4. 新增 `buildMascotImageUrl(characterId, action)` 函数，返回 `assets/mascot/{characterId}/{action}.png` 的路径
5. 默认配置中 `iconType: 'preset-images'`，`iconId: 'luoxiaohei'`

### Step 3：更新设置页 UI（settings.html）

**改动点**：
1. 替换原有的单文件上传控件（`#mascotUpload`）为 6 个独立上传区域，每行一个动作
2. 每个上传区域包含：动作名称标签 + 预览缩略图（64×64 方形） + 选择文件按钮
3. 文件限制：`accept="image/png"`，客户端校验 ≤2MB
4. 每个上传控件绑定 `data-action` 属性
5. 替换原有的"提示词"展示框为"每个动作可上传自定义 PNG 图标（≤2MB）"说明文字

**UI 布局**：
```
┌──────────────────────────────────────────┐
│  奔跑  [64×64预览图]  [选择文件] 已选:xxx │
│  挥手  [64×64预览图]  [选择文件] 未选择   │
│  跳跃  [64×64预览图]  [选择文件] 未选择   │
│  思考  [64×64预览图]  [选择文件] 未选择   │
│  打盹  [64×64预览图]  [选择文件] 未选择   │
│  庆祝  [64×64预览图]  [选择文件] 未选择   │
└──────────────────────────────────────────┘
```

### Step 4：更新上传逻辑（settings.js）

**改动点**：
1. 新增 `handleMascotMultiUpload(event)` — 处理单个动作的上传
   - 获取 `event.target.dataset.action`
   - 读取文件 → base64（校验 ≤2MB，只接受 PNG）
   - 更新 `config.iconDataUrls[action] = reader.result`
   - 更新 `config.iconType = 'upload'`（任一动作上传即切换到 upload 模式）
   - 保存并通知
2. 更新 `handleMascotPreset(event)` — 选择预设时：
   - `iconType` 改为 `'preset-images'`
   - 清空 `iconDataUrls`（所有动作）
   - 保存并通知
3. 更新 `renderMascotPreview(config, action)` — 根据当前动作和 iconType 显示对应图片：
   - `'preset-images'` → 显示 `<img src="assets/mascot/{iconId}/{action}.png">`
   - `'upload'` → 显示 `<img src="config.iconDataUrls[action]">`
   - `'preset'`（旧 SVG）→ 显示 buildMascotSvg（兜底兼容）
4. 更新 `renderMascotPresets()` — 预设卡片预览区显示对应角色的默认动作图，而非内联 SVG
5. 更新 `renderMascotHistory()` 中的预览逻辑，适配 `iconDataUrls` 对象

### Step 5：更新编辑器显示逻辑（editor.js）

**改动点**：
1. 更新 `applyMascotPreference()` 中的显示逻辑：
   - 获取当前 `config.action`
   - 根据 `config.iconType` 决定：
     - `'preset-images'` → 显示 `<img class="ai-pet-image" src="assets/mascot/{iconId}/{action}.png">`
     - `'upload'` → 显示 `<img class="ai-pet-image" src="config.iconDataUrls[action]">`
     - `'preset'` → 显示 SVG（原有逻辑，兜底兼容）
     - 兜底 → 显示默认 SVG（原有逻辑）
2. 保留 `data-action` 属性设置，确保 CSS 动画正常工作
3. 保留 `title` 属性显示当前动作中文名

### Step 6：PNG 转 SVG 包装（决策说明）

**结论**：不强制转 SVG，保持 `<img>` 显示方式。

理由：
- CSS 动画（transform/opacity）对 `<img>` 同样生效
- 现有 `ai-pet-image` 类已有动画支持（`.ai-pet-image { animation: ai-pet-run 700ms ... }`）
- 所有动作对应的 CSS 动画（`.ai-pet-button[data-action="wave"] .ai-pet-svg`）需同步添加 `.ai-pet-image` 选择器

需要额外补充的 CSS（editor.css）：
```css
/* 为 .ai-pet-image 补充动作动画（当前只有 .ai-pet-svg 有动作动画） */
.ai-pet-button[data-action="wave"] .ai-pet-image { animation: ai-dino-wave 600ms ease-in-out infinite alternate; }
.ai-pet-button[data-action="jump"] .ai-pet-image { animation: ai-dino-jump 900ms ease-in-out infinite; }
.ai-pet-button[data-action="think"] .ai-pet-image { animation: ai-dino-think 1.8s ease-in-out infinite; }
.ai-pet-button[data-action="sleep"] .ai-pet-image { animation: ai-dino-sleep 2.4s ease-in-out infinite; opacity: .8; }
.ai-pet-button[data-action="celebrate"] .ai-pet-image { animation: ai-dino-celebrate 650ms ease-in-out infinite; }
.ai-pet-button.sleeping .ai-pet-image { animation: ai-dino-sleep 2.4s ease-in-out infinite; opacity: .72; }
.ai-pet-button.thinking .ai-pet-image { animation: ai-pet-run 320ms steps(2, end) infinite; }
.ai-pet-button.error .ai-pet-image { animation: ai-pet-shake 300ms ease-in-out infinite; }
.ai-pet-button.happy .ai-pet-image { animation: ai-pet-happy 500ms ease-in-out 3; }
```

### Step 7：清理旧代码

- 删除 `buildMascotSvg()` 中的四个预设 SVG 字符串（robot-blue、pikachu-yellow、turtle-green、luoxiaohei）
- 保留兜底 fallback（一个最简 SVG 头像）
- 删除 `MASCOT_PRESETS` 中已无用的 `svg` 字段引用

---

## 四、关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| PNG 转 SVG 方式 | 保持 `<img>` 显示，不强制转 SVG | CSS 动画对 `<img>` 的 transform/opacity 同样生效；位图追踪复杂且不可靠 |
| 默认图片存储 | `frontend/assets/mascot/` 目录 | 静态资源路径，前端可直接引用 |
| 上传图片存储 | localStorage base64（同现有模式） | 保持一致性，无需额外后端存储 |
| 预设选择后的行为 | 切换为 `preset-images` 类型，显示对应角色的 PNG 图片 | 替换原有内联 SVG 方案 |
| CSS 动画兼容 | 为 `.ai-pet-image` 补充与 `.ai-pet-svg` 相同的动作动画 | 确保 PNG 图片也有动作动画效果 |
| 默认预设值 | `luoxiaohei`（罗小黑） | 用户指定罗小黑为默认 IP 形象 |

---

## 五、验证步骤

1. 确认 24 张图片已生成到 `frontend/assets/mascot/` 目录
2. 打开设置页，确认四个预设卡片能正常显示对应角色的默认动作图
3. 切换预设，确认编辑器底部宠物按钮图标更新为对应角色的 PNG
4. 上传 6 张自定义 PNG（每个动作各一张），确认每个动作对应图片正确
5. 切换不同动作，确认编辑器按钮显示对应动作图片
6. 确认 CSS 动画（thinking 快速奔跑、sleeping 打盹、error 抖动等）在 `<img>` 上正常生效
7. 确认上传超过 2MB 的 PNG 时被拒绝并提示
8. 确认非 PNG 文件上传时被拒绝