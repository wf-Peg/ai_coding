/* 自包含的 Ace Markdown 模式：仅依赖核心模块（oop / text / text_highlight_rules）。
   通过扩展 text 模式实现 Markdown 语法高亮，无需引入 html/javascript/css 等模式文件。 */
ace.define("ace/mode/markdown_highlight_rules", ["require", "exports", "module", "ace/lib/oop", "ace/mode/text_highlight_rules"], function(require, exports, module) {
"use strict";

var oop = require("../lib/oop");
var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;

var MarkdownHighlightRules = function() {
    this.$rules = {
        start: [
            // HTML 注释（可跨行）
            {
                token: "comment",
                regex: /<!--/,
                next: "comment"
            },
            // 围栏代码块 ``` 或 ~~~，可选语言标签
            {
                token: ["support.function", "constant.language"],
                regex: /^(```|~~~)([ \t]*\w+)?[ \t]*$/,
                next: "codeblock"
            },
            // ATX 标题 # ~ ######
            {
                token: "markup.heading.1",
                regex: /^#{1,6}\s+\S.*$/
            },
            // Setext 一级标题下划线 ===
            {
                token: "markup.heading.1",
                regex: /^=+\s*$/
            },
            // 分割线 --- / *** / ___
            {
                token: "constant.language",
                regex: /^[ \t]*((\*|_|-)[ \t]*){3,}$/
            },
            // 引用块
            {
                token: "markup.quote",
                regex: /^[ \t]*>[ \t]?/
            },
            // 无序列表
            {
                token: "markup.list",
                regex: /^[ \t]*[-+*][ \t]+/
            },
            // 有序列表
            {
                token: "markup.list",
                regex: /^[ \t]*\d+\.[ \t]+/
            },
            // 表格分隔行
            {
                token: "markup.table",
                regex: /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/
            },
            // 图片 ![alt](url)
            {
                token: ["markup.image", "string", "markup.image"],
                regex: /(!\[)([^\]]*)(\]\([^)\s]+(?:\s+"[^"]*")?[ \t]*\))/
            },
            // 链接 [text](url)
            {
                token: ["markup.link", "string", "markup.link"],
                regex: /(\[)([^\]]+)(\]\([^)\s]+(?:\s+"[^"]*")?[ \t]*\))/
            },
            // 行内代码 `code`
            {
                token: "markup.raw.inline",
                regex: /(`+)([^`\n]*?)(\1)/
            },
            // 粗体 **text** / __text__
            {
                token: "markup.bold",
                regex: /(\*\*|__)(?=\S)([\s\S]*?\S)\1/
            },
            // 斜体 *text* / _text_
            {
                token: "markup.italic",
                regex: /(\*|_)(?=\S)([^\*\s_][\s\S]*?\S)\1/
            },
            // 删除线 ~~text~~
            {
                token: "markup.strikethrough",
                regex: /(~~)(?=\S)([\s\S]*?\S)\1/
            }
        ],
        comment: [
            { token: "comment", regex: /-->/, next: "start" },
            { defaultToken: "comment" }
        ],
        codeblock: [
            {
                token: "support.function",
                regex: /^(```|~~~)[ \t]*$/,
                next: "start"
            },
            { defaultToken: "markup.raw" }
        ]
    };
    this.normalizeRules();
};

oop.inherits(MarkdownHighlightRules, TextHighlightRules);

exports.MarkdownHighlightRules = MarkdownHighlightRules;
});

ace.define("ace/mode/markdown", ["require", "exports", "module", "ace/lib/oop", "ace/mode/text", "ace/mode/markdown_highlight_rules"], function(require, exports, module) {
"use strict";

var oop = require("../lib/oop");
var TextMode = require("./text").Mode;
var MarkdownHighlightRules = require("./markdown_highlight_rules").MarkdownHighlightRules;

var Mode = function() {
    this.HighlightRules = MarkdownHighlightRules;
};
oop.inherits(Mode, TextMode);

(function() {
    this.type = "text";
    this.blockComment = { start: "<!--", end: "-->" };
    this.$quotes = { '"': '"', "`": "`" };

    this.getNextLineIndent = function(state, line, tab) {
        if (state == "listblock") {
            var match = /^(\s*)(?:([-+*])|(\d+)\.)(\s+)/.exec(line);
            if (!match)
                return "";
            var marker = match[2];
            if (!marker)
                marker = parseInt(match[3], 10) + 1 + ".";
            return match[1] + marker + match[4];
        } else {
            return this.$getIndent(line);
        }
    };
    this.$id = "ace/mode/markdown";
}).call(Mode.prototype);

exports.Mode = Mode;
});

(function() {
    ace.require(["ace/mode/markdown"], function(m) {
        if (typeof module == "object" && typeof exports == "object" && module) {
            module.exports = m;
        }
    });
})();
