# Bug 历史记录

> 记录每次 bug 的现象、原因、修复方式和经验教训，供 AI 和开发者参考。
> 后续可依据 bug 历史更新 agent.md 约束，避免同类问题重复出现。

## 格式

```markdown
### [日期] Bug 标题

- **现象**：
- **原因**：
- **修复方式**：
- **经验教训**：
- **相关文件**：
```

### [2026-08-15] 剪藏页主题回归：原文省略号失效 + 「更多功能」下拉深色白底

- **现象**：全局主题优化后，剪藏列表中单条剪藏「原文」字段不再按行截断显示省略号（内容全文铺开）；深色主题下「更多功能」下拉面板背景为白色，与主题不贴合。
- **原因**：①「原文」内容已由纯文本转义改为 markdown 渲染（块级 `<p>/<pre>/<h1>` 等），其浏览器默认外边距与 `<pre>` 不换行破坏了 `.content-text.truncated` 的 `-webkit-line-clamp` 省略号；② `.fan-drawer` 硬编码 `background: rgba(255,255,255,0.96)`，主题收敛时漏改（对比 `.float-bar` 已做 `html[data-theme="dark"]` 覆盖）。
- **修复方式**：① `.content-text.truncated > *` 归零外边距，并对 `pre/pre code` 设 `white-space: pre-wrap; word-break: break-word`；② `.fan-drawer` 背景改为 `var(--surface)`（随 design-tokens 三主题自适应）。
- **经验教训**：对自包含 HTML/富文本容器做 `-webkit-line-clamp` 截断时，需先归零内部块级元素的外边距并处理 `<pre>` 换行，否则省略号不生效；主题化改造应全局排查硬编码 `rgba(255,255,255,*)` 的容器背景，统一收敛为语义令牌。
- **相关文件**：`frontend/styles/clip.css`

---

<!-- 新 bug 记录追加在此行之上 -->