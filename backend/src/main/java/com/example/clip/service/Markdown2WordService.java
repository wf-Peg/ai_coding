package com.example.clip.service;

import com.vladsch.flexmark.ast.BlockQuote;
import com.vladsch.flexmark.ast.BulletList;
import com.vladsch.flexmark.ast.Code;
import com.vladsch.flexmark.ast.Emphasis;
import com.vladsch.flexmark.ast.FencedCodeBlock;
import com.vladsch.flexmark.ast.HardLineBreak;
import com.vladsch.flexmark.ast.Heading;
import com.vladsch.flexmark.ast.Image;
import com.vladsch.flexmark.ast.IndentedCodeBlock;
import com.vladsch.flexmark.ast.Link;
import com.vladsch.flexmark.ast.ListItem;
import com.vladsch.flexmark.ast.OrderedList;
import com.vladsch.flexmark.ast.Paragraph;
import com.vladsch.flexmark.ast.SoftLineBreak;
import com.vladsch.flexmark.ast.StrongEmphasis;
import com.vladsch.flexmark.ast.Text;
import com.vladsch.flexmark.ext.gfm.strikethrough.Strikethrough;
import com.vladsch.flexmark.ext.tables.TableBlock;
import com.vladsch.flexmark.ext.tables.TableCell;
import com.vladsch.flexmark.ext.tables.TableHead;
import com.vladsch.flexmark.ext.tables.TableRow;
import com.vladsch.flexmark.parser.Parser;
import com.vladsch.flexmark.util.ast.Node;
import com.vladsch.flexmark.util.ast.NodeVisitor;
import com.vladsch.flexmark.util.ast.TextCollectingVisitor;
import com.vladsch.flexmark.util.ast.VisitHandler;
import com.vladsch.flexmark.util.data.MutableDataSet;
import org.apache.poi.util.Units;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFParagraph;
import org.apache.poi.xwpf.usermodel.XWPFRelation;
import org.apache.poi.xwpf.usermodel.XWPFRun;
import org.apache.poi.xwpf.usermodel.XWPFTableCell;
import org.apache.poi.xwpf.usermodel.XWPFTable;
import org.apache.poi.xwpf.usermodel.XWPFTableRow;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTShd;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.STShd;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Markdown 转 Word (.docx) 服务。
 * <p>
 * 使用 flexmark 将 Markdown 解析为 AST，遍历节点生成 Apache POI 的
 * {@link XWPFDocument}，支持标题、段落、有序/无序列表、表格、代码块、
 * 引用、图片（base64 / dataURL / 请求附带图片映射）以及行内加粗/斜体/
 * 删除线/行内代码等格式。
 * </p>
 */
@Service
public class Markdown2WordService {

    private static final Logger log = LoggerFactory.getLogger(Markdown2WordService.class);

    /** 等宽字体（代码块） */
    private static final String MONO_FONT = "Consolas";
    /** 中文环境等宽回退字体 */
    private static final String MONO_FONT_EAST_ASIA = "Microsoft YaHei";

    private final Parser parser;

    public Markdown2WordService() {
        MutableDataSet options = new MutableDataSet();
        options.set(Parser.EXTENSIONS, List.of(
                com.vladsch.flexmark.ext.tables.TablesExtension.create(),
                com.vladsch.flexmark.ext.autolink.AutolinkExtension.create(),
                com.vladsch.flexmark.ext.gfm.strikethrough.StrikethroughExtension.create(),
                com.vladsch.flexmark.ext.gfm.tasklist.TaskListExtension.create()
        ));
        this.parser = Parser.builder(options).build();
    }

    /**
     * 将 Markdown 内容转换为 .docx 二进制流。
     *
     * @param markdown Markdown 源文本
     * @param images   Mermaid 等前端转换的图片映射：{name: dataURL(base64)}
     * @return .docx 二进制字节
     * @throws IOException 生成失败时抛出
     */
    public byte[] convertToDocx(String markdown, Map<String, String> images) throws IOException {
        Map<String, byte[]> imageBytes = new HashMap<>();
        if (images != null) {
            images.forEach((name, dataUrl) -> {
                byte[] bytes = decodeDataUrl(dataUrl);
                if (bytes != null) {
                    imageBytes.put(String.valueOf(name), bytes);
                }
            });
        }

        Node document = parser.parse(markdown == null ? "" : markdown);

        try (XWPFDocument doc = new XWPFDocument();
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            List<Integer> listCounters = new ArrayList<>();
            new Converter(doc, imageBytes, listCounters).renderDocument(document);
            doc.write(out);
            return out.toByteArray();
        }
    }

    /** 解析 dataURL（data:image/png;base64,xxx）为字节数组，失败返回 null */
    private static byte[] decodeDataUrl(String dataUrl) {
        if (dataUrl == null || dataUrl.isBlank()) {
            return null;
        }
        try {
            String base64 = dataUrl;
            int comma = dataUrl.indexOf(',');
            if (dataUrl.startsWith("data:") && comma >= 0) {
                base64 = dataUrl.substring(comma + 1);
            }
            String clean = base64.replaceAll("\\s", "");
            if (clean.isEmpty()) {
                return null;
            }
            return Base64.getDecoder().decode(clean);
        } catch (IllegalArgumentException e) {
            log.warn("[Markdown2Word] 解码嵌入图片失败: {}", e.getMessage());
            return null;
        }
    }

    /**
     * 单次转换的节点访问器。
     * <p>
     * 通过 {@link NodeVisitor} 遍历 AST，按块级节点类型生成 Word 元素。
     * </p>
     */
    private static class Converter {

        private final XWPFDocument doc;
        private final Map<String, byte[]> images;
        private final List<Integer> listCounters;

        Converter(XWPFDocument doc, Map<String, byte[]> images, List<Integer> listCounters) {
            this.doc = doc;
            this.images = images;
            this.listCounters = listCounters;
        }

        private final NodeVisitor visitor = new NodeVisitor(
                new VisitHandler<>(Heading.class, this::visitHeading),
                new VisitHandler<>(Paragraph.class, this::visitParagraph),
                new VisitHandler<>(BulletList.class, this::visitBulletList),
                new VisitHandler<>(OrderedList.class, this::visitOrderedList),
                new VisitHandler<>(TableBlock.class, this::visitTable),
                new VisitHandler<>(FencedCodeBlock.class, this::visitFencedCode),
                new VisitHandler<>(IndentedCodeBlock.class, this::visitIndentedCode),
                new VisitHandler<>(BlockQuote.class, this::visitBlockQuote),
                new VisitHandler<>(ListItem.class, this::visitListItem)
        );

        void renderDocument(Node document) {
            visitor.visitChildren(document);
        }

        // ===== 块级节点 =====

        private void visitHeading(Heading node) {
            XWPFParagraph p = doc.createParagraph();
            p.setSpacingBefore(240);
            p.setSpacingAfter(120);
            // 标题级别 H1-H6；setStyle 可被 Word 主题识别，但样式必须存在，故直接设置字体
            int level = Math.min(6, Math.max(1, node.getLevel()));
            int fontSize = 22 - level * 2; // H1=20pt ... H6=10pt
            XWPFRun run = p.createRun();
            run.setText(collectText(node));
            run.setBold(true);
            run.setFontSize(fontSize);
            run.setColor("000000");
        }

        private void visitParagraph(Paragraph node) {
            XWPFParagraph p = doc.createParagraph();
            p.setSpacingAfter(120);
            addInline(p, node);
        }

        private void visitBulletList(BulletList node) {
            listCounters.add(0);
            visitor.visitChildren(node);
            listCounters.remove(listCounters.size() - 1);
        }

        private void visitOrderedList(OrderedList node) {
            listCounters.add(0);
            visitor.visitChildren(node);
            listCounters.remove(listCounters.size() - 1);
        }

        private void visitListItem(ListItem node) {
            // 当前所在的列表是编号还是项目符号，由 includeHeading 属性无法区分，改用父级判断
            boolean ordered = node.getParent() instanceof OrderedList;
            XWPFParagraph p = doc.createParagraph();
            p.setIndentationLeft(360);
            p.setSpacingAfter(60);

            int counter = 0;
            if (ordered && !listCounters.isEmpty()) {
                counter = listCounters.get(listCounters.size() - 1) + 1;
                listCounters.set(listCounters.size() - 1, counter);
            }
            String prefix = ordered ? (counter + ".  ") : "•  ";

            XWPFRun prefixRun = p.createRun();
            prefixRun.setText(prefix);

            // ListItem 内通常是 Paragraph；若嵌套列表则递归
            for (Node child : node.getChildren()) {
                if (child instanceof Paragraph) {
                    addInline(p, child);
                } else {
                    visitor.visit(child);
                }
            }
        }

        private void visitTable(TableBlock node) {
            // 提取表头行与数据行
            List<XWPFTableRow> rows = new ArrayList<>();
            List<String> headerCells = new ArrayList<>();
            List<List<String>> bodyRows = new ArrayList<>();

            for (Node child : node.getChildren()) {
                if (child instanceof TableHead) {
                    for (Node rowNode : child.getChildren()) {
                        if (rowNode instanceof TableRow) {
                            for (Node cellNode : ((TableRow) rowNode).getChildren()) {
                                if (cellNode instanceof TableCell) {
                                    headerCells.add(collectText(cellNode));
                                }
                            }
                        }
                    }
                } else if (child instanceof com.vladsch.flexmark.ext.tables.TableBody) {
                    for (Node rowNode : child.getChildren()) {
                        if (!(rowNode instanceof TableRow)) {
                            continue;
                        }
                        List<String> cells = new ArrayList<>();
                        for (Node cellNode : ((TableRow) rowNode).getChildren()) {
                            if (cellNode instanceof TableCell) {
                                cells.add(collectText(cellNode));
                            }
                        }
                        bodyRows.add(cells);
                    }
                }
            }

            int colCount = Math.max(1, headerCells.isEmpty() && bodyRows.isEmpty() ? 1
                    : Math.max(headerCells.size(), bodyRows.stream().mapToInt(List::size).max().orElse(1)));
            XWPFTable table = doc.createTable(headerCells.isEmpty() ? 0 : 1, Math.max(1, colCount));
            table.setWidth("100%");

            if (!headerCells.isEmpty()) {
                XWPFTableRow headerRow = table.getRow(0);
                for (int i = 0; i < Math.max(headerCells.size(), colCount); i++) {
                    XWPFTableCell cell = i < headerCells.size() ? headerRow.getCell(i)
                            : headerRow.createCell();
                    XWPFParagraph cp = cell.getParagraphs().isEmpty() ? cell.addParagraph() : cell.getParagraphs().get(0);
                    XWPFRun run = cp.createRun();
                    run.setText(headerCells.get(Math.min(i, headerCells.size() - 1)));
                    run.setBold(true);
                }
            }

            for (List<String> rowCells : bodyRows) {
                XWPFTableRow row = table.createRow();
                for (int i = 0; i < Math.max(rowCells.size(), colCount); i++) {
                    XWPFTableCell cell = i < rowCells.size() ? row.getCell(i) : row.createCell();
                    XWPFParagraph cp = cell.getParagraphs().isEmpty() ? cell.addParagraph() : cell.getParagraphs().get(0);
                    cp.createRun().setText(rowCells.get(Math.min(i, rowCells.size() - 1)));
                }
            }
        }

        private void visitFencedCode(FencedCodeBlock node) {
            XWPFParagraph p = doc.createParagraph();
            p.setSpacingAfter(120);
            setShading(p, "F2F2F2");
            XWPFRun run = p.createRun();
            run.setFontFamily(MONO_FONT);
            run.setFontSize(9);
            run.setText(node.getContentChars().toString());
        }

        private void visitIndentedCode(IndentedCodeBlock node) {
            XWPFParagraph p = doc.createParagraph();
            p.setSpacingAfter(120);
            setShading(p, "F2F2F2");
            XWPFRun run = p.createRun();
            run.setFontFamily(MONO_FONT);
            run.setFontSize(9);
            run.setText(node.getContentChars().toString());
        }

        private void visitBlockQuote(BlockQuote node) {
            XWPFParagraph p = doc.createParagraph();
            p.setSpacingAfter(120);
            p.setIndentationLeft(360);
            setLeftBorder(p);
            XWPFRun run = p.createRun();
            run.setItalic(true);
            run.setColor("595959");
            run.setText(collectText(node));
        }

        // ===== 行内内容 =====

        private void addInline(XWPFParagraph p, Node node) {
            for (Node child : node.getChildren()) {
                if (child instanceof Text) {
                    p.createRun().setText(((Text) child).getChars().toString());
                } else if (child instanceof Code) {
                    XWPFRun run = p.createRun();
                    run.setFontFamily(MONO_FONT);
                    run.setText(((Code) child).getText().toString());
                } else if (child instanceof Emphasis) {
                    XWPFRun run = p.createRun();
                    run.setItalic(true);
                    run.setText(collectText(child));
                } else if (child instanceof StrongEmphasis) {
                    XWPFRun run = p.createRun();
                    run.setBold(true);
                    run.setText(collectText(child));
                } else if (child instanceof Strikethrough) {
                    XWPFRun run = p.createRun();
                    run.setStrike(true);
                    run.setText(collectText(child));
                } else if (child instanceof Image) {
                    addImage(p, (Image) child);
                } else if (child instanceof Link) {
                    String text = collectText(child);
                    if (!text.isBlank()) {
                        p.createRun().setText(text);
                    }
                } else if (child instanceof SoftLineBreak || child instanceof HardLineBreak) {
                    p.createRun().addBreak();
                } else if (child instanceof com.vladsch.flexmark.ast.HtmlInline) {
                    p.createRun().setText(collectText(child));
                } else {
                    p.createRun().setText(collectText(child));
                }
            }
        }

        private void addImage(XWPFParagraph p, Image image) {
            String url = image.getUrl() == null ? "" : image.getUrl().toString();
            byte[] bytes = resolveImage(url);
            if (bytes == null) {
                return;
            }
            try {
                XWPFRun run = p.createRun();
                try (ByteArrayInputStream in = new ByteArrayInputStream(bytes)) {
                    run.addPicture(in, XWPFDocument.PICTURE_TYPE_PNG, "pict.png",
                            Units.toEMU(380), Units.toEMU((int) (380.0 * 0.75)));
                }
            } catch (Exception e) {
                log.warn("[Markdown2Word] 插入图片失败: {}", e.getMessage());
            }
        }

        private byte[] resolveImage(String url) {
            if (url == null || url.isBlank()) {
                return null;
            }
            // 1. dataURL 直接解析
            if (url.startsWith("data:")) {
                return decodeDataUrl(url);
            }
            // 2. 请求附带的图片映射（Mermaid 等）
            if (images.containsKey(url)) {
                return images.get(url);
            }
            // 3. 去掉 ./ 前缀后按名称匹配
            String bare = url.replaceAll("^[./\\\\]+", "");
            if (images.containsKey(bare)) {
                return images.get(bare);
            }
            return null;
        }

        // ===== 工具 =====

        private String collectText(Node node) {
            return new TextCollectingVisitor().collectAndGetText(node);
        }

        private void setShading(XWPFParagraph p, String fill) {
            try {
                CTShd shd = p.getCTP().addNewPPr().addNewShd();
                shd.setVal(STShd.CLEAR);
                shd.setColor("auto");
                shd.setFill(fill);
            } catch (Exception ignore) {
                // 样式设置失败不影响导出
            }
        }

        private void setLeftBorder(XWPFParagraph p) {
            try {
                p.getCTP().addNewPPr().addNewPBdr().addNewLeft()
                        .setVal(org.openxmlformats.schemas.wordprocessingml.x2006.main.STBorder.SINGLE);
                p.getCTP().getPPr().getPBdr().getLeft().setSz(java.math.BigInteger.valueOf(12));
                p.getCTP().getPPr().getPBdr().getLeft().setColor("BFBFBF");
            } catch (Exception ignore) {
                // 边框设置失败不影响导出
            }
        }
    }
}