package com.example.clip.service.wiki;

import com.example.clip.config.WikiConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

/**
 * Wiki 页面文件服务。
 * <p>
 * 负责在 Obsidian Vault 内管理 Wiki 页面文件的 CRUD 操作，包括：
 * <ul>
 *   <li>按页面类型解析页面路径（entity/concept/synthesis/source）</li>
 *   <li>创建、读取、更新页面文件</li>
 *   <li>列出某类型或全部类型的页面文件</li>
 *   <li>检测页面是否被手工编辑（manual-edited frontmatter 标记）</li>
 *   <li>初始化 Wiki 目录结构（entities/concepts/synthesis/sources + index.md + log.md）</li>
 * </ul>
 * </p>
 *
 * <p>
 * 页面路径约定：
 * <ul>
 *   <li>entity → {@code {vaultPath}/{wikiDirName}/entities/{name}.md}</li>
 *   <li>concept → {@code {vaultPath}/{wikiDirName}/concepts/{name}.md}</li>
 *   <li>synthesis → {@code {vaultPath}/{wikiDirName}/synthesis/{title}.md}</li>
 *   <li>source → {@code {vaultPath}/{wikiDirName}/sources/{sourceName}.md}</li>
 * </ul>
 * </p>
 */
@Service
public class WikiPageService {

    private static final Logger log = LoggerFactory.getLogger(WikiPageService.class);

    /** 页面类型 → 子目录名映射（entity→entities, concept→concepts 等） */
    private static final java.util.Map<String, String> TYPE_TO_DIR = java.util.Map.of(
            "entity", "entities",
            "concept", "concepts",
            "synthesis", "synthesis",
            "source", "sources"
    );

    /** Wiki 目录 README.md 说明文档内容，在 initWikiStructure 时幂等创建 */
    private static final String README_CONTENT = """
            # Wiki 知识库

            本目录由 CutShelter 后端自动维护，基于 LLM Wiki 理论构建。

            ## 目录结构

            - `entities/` — 实体页面（人物、产品、技术、组织、地点）
            - `concepts/` — 概念页面（主题、思想、理论、方法）
            - `synthesis/` — 综述页面（查询答案归档、跨源综合分析）
            - `sources/` — 来源页面（每条剪藏的原始摘要和 AI 分析）
            - `index.md` — 内容索引（按类型分组的页面清单）
            - `log.md` — 操作日志（ingest/query/lint 记录）
            - `lint-report.md` — 健康检查报告（按需生成）
            - `MOC_*.md` — Map of Content（分类导航页）

            ## Obsidian 使用建议

            ### Graph View
            打开 Obsidian 的 Graph View 可视化页面连接网络，发现知识 hub 和孤岛。

            ### Backlinks
            在任意 wiki 页面查看 Backlinks 面板，了解哪些页面引用了当前页面。

            ### Dataview
            安装 Dataview 插件后，可基于 frontmatter 字段生成动态列表：

            ```dataview
            TABLE updated, type
            FROM "wiki"
            WHERE type != null
            SORT updated DESC
            ```

            ### MOC 导航
            `MOC_实体.md`、`MOC_概念.md` 等页面是分类导航入口，按更新时间倒序列出该类型的所有页面。

            ### 手动编辑保护
            在页面 frontmatter 中添加 `manual-edited: true` 可保护页面不被 AI 自动更新覆盖：

            ```yaml
            ---
            manual-edited: true
            ---
            ```

            AI 会在该页面末尾的"最近来源"区域追加新来源引用，但不会修改已有内容。

            ## frontmatter 字段说明

            | 字段 | 说明 | 示例 |
            |---|---|---|
            | date | 创建日期 | 2026-07-30 |
            | updated | 更新日期（Dataview 排序用） | 2026-07-30 |
            | type | 页面类型（Dataview 筛选用） | entity / concept / synthesis / source / moc |
            | tags | 标签列表 | [React, Frontend] |
            | aliases | Obsidian 别名（wiki-link 容错） | [ReactJS, React.js] |
            | category | 分类名 | entity |
            | source | 来源 URL 列表 | [https://...] |

            ## wiki-link 规范

            页面间引用使用 `[[页面名]]` 语法，例如 `[[React]]`、`[[Virtual DOM]]`。
            如需显示不同文本，使用 `[[页面名|显示名]]`，例如 `[[React|React 框架]]`。
            """;

    private final WikiConfig config;

    /**
     * 构造器注入配置。
     *
     * @param config Wiki 配置
     */
    public WikiPageService(WikiConfig config) {
        this.config = config;
    }

    /**
     * 根据页面类型和名称返回页面文件路径。
     *
     * @param pageType 页面类型（entity/concept/synthesis/source）
     * @param name     页面名称（不含扩展名）
     * @return 页面文件绝对路径
     */
    public Path getPagePath(String pageType, String name) {
        String dirName = TYPE_TO_DIR.getOrDefault(pageType, pageType + "s");
        return Paths.get(config.getVaultPath())
                .resolve(config.getWikiDirName())
                .resolve(dirName)
                .resolve(name + ".md");
    }

    /**
     * 创建页面文件并写入内容，自动创建父目录。
     *
     * @param pageType 页面类型
     * @param name     页面名称
     * @param content  页面内容
     */
    public void createPage(String pageType, String name, String content) {
        try {
            Path pagePath = getPagePath(pageType, name);
            Path parent = pagePath.getParent();
            if (parent != null && !Files.exists(parent)) {
                Files.createDirectories(parent);
            }
            Files.writeString(pagePath, content);
            log.info("[Wiki] Created page: {}", pagePath);
        } catch (IOException e) {
            log.error("[Wiki] Failed to create page [{}/{}]: {}", pageType, name, e.getMessage());
        }
    }

    /**
     * 覆盖更新已有页面文件内容。
     *
     * @param pagePath 页面路径
     * @param content  新内容
     */
    public void updatePage(Path pagePath, String content) {
        try {
            Files.writeString(pagePath, content);
            log.info("[Wiki] Updated page: {}", pagePath);
        } catch (IOException e) {
            log.error("[Wiki] Failed to update page [{}]: {}", pagePath, e.getMessage());
        }
    }

    /**
     * 读取页面内容。
     *
     * @param pagePath 页面路径
     * @return 页面内容字符串；文件不存在时返回 null
     */
    public String readPage(Path pagePath) {
        if (!Files.exists(pagePath)) {
            return null;
        }
        try {
            return Files.readString(pagePath);
        } catch (IOException e) {
            log.error("[Wiki] Failed to read page [{}]: {}", pagePath, e.getMessage());
            return null;
        }
    }

    /**
     * 判断指定页面是否存在。
     *
     * @param pageType 页面类型
     * @param name     页面名称
     * @return true 表示页面文件存在
     */
    public boolean pageExists(String pageType, String name) {
        return Files.exists(getPagePath(pageType, name));
    }

    /**
     * 列出某页面类型目录下的所有 .md 文件。
     *
     * @param pageType 页面类型
     * @return .md 文件路径列表；目录不存在时返回空列表
     */
    public List<Path> listPages(String pageType) {
        String dirName = TYPE_TO_DIR.getOrDefault(pageType, pageType + "s");
        Path dir = Paths.get(config.getVaultPath())
                .resolve(config.getWikiDirName())
                .resolve(dirName);
        return listMarkdownFiles(dir);
    }

    /**
     * 列出所有页面类型目录下的 .md 文件。
     *
     * @return 所有 .md 文件路径列表
     */
    public List<Path> listAllPages() {
        List<Path> all = new ArrayList<>();
        for (String pageType : config.getPageTypes()) {
            all.addAll(listPages(pageType));
        }
        return all;
    }

    /**
     * 判断页面是否被手工编辑过（frontmatter 中 {@code manual-edited: true}）。
     *
     * @param pagePath 页面路径
     * @return true 表示页面 frontmatter 中标记了 manual-edited: true
     */
    public boolean isManualEdited(Path pagePath) {
        String content = readPage(pagePath);
        if (content == null || content.isEmpty()) {
            return false;
        }
        // 仅在 frontmatter 块内检查，避免正文误触发
        int firstIdx = content.indexOf("---");
        if (firstIdx < 0) {
            return false;
        }
        int secondIdx = content.indexOf("---", firstIdx + 3);
        if (secondIdx < 0) {
            return false;
        }
        String frontmatter = content.substring(firstIdx, secondIdx);
        return frontmatter.contains("manual-edited: true");
    }

    /**
     * 初始化 Wiki 目录结构。
     * <p>
     * 创建 entities/、concepts/、synthesis/、sources/ 子目录，以及初始的
     * index.md、log.md 和 README.md 文件（仅在不存在时创建，保证幂等）。
     * README.md 包含 Obsidian 使用建议、frontmatter 字段说明和 wiki-link 规范。
     * </p>
     */
    public void initWikiStructure() {
        try {
            Path wikiRoot = Paths.get(config.getVaultPath()).resolve(config.getWikiDirName());
            if (!Files.exists(wikiRoot)) {
                Files.createDirectories(wikiRoot);
            }
            for (String dirName : TYPE_TO_DIR.values()) {
                Path typeDir = wikiRoot.resolve(dirName);
                if (!Files.exists(typeDir)) {
                    Files.createDirectories(typeDir);
                }
            }
            Path indexPath = wikiRoot.resolve("index.md");
            if (!Files.exists(indexPath)) {
                Files.writeString(indexPath, "# Wiki Index\n\n");
            }
            Path logPath = wikiRoot.resolve("log.md");
            if (!Files.exists(logPath)) {
                Files.writeString(logPath, "# Wiki Log\n\n");
            }
            Path readmePath = wikiRoot.resolve("README.md");
            if (!Files.exists(readmePath)) {
                Files.writeString(readmePath, README_CONTENT);
            }
            log.info("[Wiki] Initialized wiki structure at {}", wikiRoot);
        } catch (IOException e) {
            log.error("[Wiki] Failed to init wiki structure: {}", e.getMessage());
        }
    }

    /**
     * 列出指定目录下的所有 .md 文件（不递归）。
     *
     * @param dir 目标目录
     * @return .md 文件路径列表；目录不存在或读取失败时返回空列表
     */
    private List<Path> listMarkdownFiles(Path dir) {
        if (!Files.exists(dir) || !Files.isDirectory(dir)) {
            return List.of();
        }
        try (Stream<Path> stream = Files.list(dir)) {
            return stream
                    .filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(".md"))
                    .toList();
        } catch (IOException e) {
            log.error("[Wiki] Failed to list markdown files in [{}]: {}", dir, e.getMessage());
            return List.of();
        }
    }
}
