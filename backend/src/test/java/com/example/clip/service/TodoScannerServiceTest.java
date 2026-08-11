package com.example.clip.service;

import com.example.clip.model.ClipContent;
import com.example.clip.model.TodoContent;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * TodoScannerService 全链路测试（与 spec/SKILL 字段约定对齐）
 * <p>
 * 验证：feature-points.json 解析 → 剪藏/待办落库 → 幂等 → 增量导入
 * </p>
 */
class TodoScannerServiceTest {

    @TempDir
    Path tempDir;

    private Path todoRoot;
    private ClipService clipService;
    private TodoService todoService;
    private TodoScannerService scanner;

    @BeforeEach
    void setUp() throws Exception {
        todoRoot = tempDir.resolve("TODO");
        Files.createDirectories(todoRoot);
        FileStorageService storage = new FileStorageService(tempDir.resolve("storage").toString());
        clipService = mock(ClipService.class);
        when(clipService.saveClip(any(ClipContent.class))).thenAnswer(inv -> inv.getArgument(0));
        todoService = new TodoService(storage);
        scanner = new TodoScannerService(clipService, todoService, todoRoot.toString());
    }

    private void writeFeaturePoints(String requirementDir, String json) throws Exception {
        Path dir = todoRoot.resolve(requirementDir);
        Files.createDirectories(dir);
        Files.writeString(dir.resolve("feature-points.json"), json);
        Files.writeString(dir.resolve("02-设计文档.md"),
                "# 设计文档\n\n## 功能点 fp-001\n\n接口定义 A\n\n## 功能点 fp-002\n\n接口定义 B\n");
    }

    @Test
    void importsClipsAndTodosFromFeaturePoints() throws Exception {
        writeFeaturePoints("测试需求A", """
                {
                  "version": "1.0",
                  "requirement": {
                    "title": "测试需求A",
                    "summary": "验证字段对齐",
                    "tags": ["product-dev", "需求标签"],
                    "phase": "completed",
                    "createdAt": "2026-08-10T10:00:00",
                    "completedAt": "2026-08-10T18:00:00"
                  },
                  "featurePoints": [
                    {
                      "id": "fp-001",
                      "name": "后端落库",
                      "description": "扫描并落库",
                      "layer": "backend",
                      "tags": ["product-dev"],
                      "clips": [
                        {
                          "title": "设计文档-落库",
                          "contentFile": "02-设计文档.md",
                          "section": "## 功能点 fp-001",
                          "category": "product-dev/design",
                          "tags": ["设计文档"]
                        }
                      ],
                      "todos": [
                        { "title": "实现扫描服务", "priority": "high", "status": "done" }
                      ]
                    }
                  ],
                  "config": {
                    "clipCategory": "product-dev",
                    "todoCategory": "product-dev",
                    "autoTag": "product-dev"
                  }
                }
                """);

        TodoScannerService.ScanResult result = scanner.scanAndImport();

        assertEquals(1, result.dirsScanned());
        assertEquals(1, result.dirsImported());
        assertEquals(1, result.clipsCreated());
        assertEquals(1, result.todosCreated());
        assertTrue(result.errors().isEmpty());

        // 剪藏参数校验：title / category / tags / section 截取
        ArgumentCaptor<ClipContent> clipCaptor = ArgumentCaptor.forClass(ClipContent.class);
        verify(clipService, times(1)).saveClip(clipCaptor.capture());
        ClipContent clip = clipCaptor.getValue();
        assertEquals("设计文档-落库", clip.getTitle());
        assertEquals("product-dev/design", clip.getCategory());
        assertTrue(clip.getTags().contains("product-dev"));
        assertTrue(clip.getTags().contains("需求标签"));
        assertTrue(clip.getTags().contains("设计文档"));
        assertTrue(clip.getContent().contains("接口定义 A"));
        assertFalse(clip.getContent().contains("接口定义 B"), "section 应截取 fp-001 章节");

        // 待办参数校验：status=done 映射 completed=true
        List<TodoContent> todos = todoService.getAllTodos();
        assertEquals(1, todos.size());
        TodoContent todo = todos.get(0);
        assertEquals("实现扫描服务", todo.getTitle());
        assertEquals("product-dev", todo.getCategory());
        assertTrue(todo.isCompleted(), "status=done 应映射为已完成");

        // .imported 标记写入
        assertTrue(Files.exists(todoRoot.resolve("测试需求A").resolve(".imported")));
    }

    @Test
    void isIdempotentOnSecondScan() throws Exception {
        writeFeaturePoints("测试需求A", """
                {
                  "version": "1.0",
                  "requirement": { "title": "测试需求A", "summary": "s", "tags": ["product-dev"] },
                  "featurePoints": [
                    {
                      "id": "fp-001",
                      "name": "功能点一",
                      "clips": [
                        { "title": "剪藏一", "contentFile": "02-设计文档.md", "category": "product-dev", "tags": [] }
                      ],
                      "todos": [
                        { "title": "待办一", "priority": "medium", "status": "todo" }
                      ]
                    }
                  ],
                  "config": { "clipCategory": "product-dev", "todoCategory": "product-dev", "autoTag": "product-dev" }
                }
                """);

        TodoScannerService.ScanResult first = scanner.scanAndImport();
        TodoScannerService.ScanResult second = scanner.scanAndImport();

        assertEquals(1, first.clipsCreated());
        assertEquals(1, first.todosCreated());
        assertEquals(0, second.clipsCreated(), "二次扫描不应重复导入剪藏");
        assertEquals(0, second.todosCreated(), "二次扫描不应重复导入待办");
        verify(clipService, times(1)).saveClip(any(ClipContent.class));
    }

    @Test
    void incrementallyImportsNewFeaturePointsOnly() throws Exception {
        writeFeaturePoints("测试需求A", """
                {
                  "version": "1.0",
                  "requirement": { "title": "测试需求A", "summary": "s", "tags": ["product-dev"] },
                  "featurePoints": [
                    {
                      "id": "fp-001",
                      "name": "功能点一",
                      "clips": [
                        { "title": "剪藏一", "contentFile": "02-设计文档.md", "category": "product-dev", "tags": [] }
                      ],
                      "todos": []
                    }
                  ],
                  "config": { "clipCategory": "product-dev", "todoCategory": "product-dev", "autoTag": "product-dev" }
                }
                """);

        scanner.scanAndImport();
        verify(clipService, times(1)).saveClip(any(ClipContent.class));

        // 追加 fp-002 后再次扫描，仅导入新功能点
        writeFeaturePoints("测试需求A", """
                {
                  "version": "1.0",
                  "requirement": { "title": "测试需求A", "summary": "s", "tags": ["product-dev"] },
                  "featurePoints": [
                    {
                      "id": "fp-001",
                      "name": "功能点一",
                      "clips": [
                        { "title": "剪藏一", "contentFile": "02-设计文档.md", "category": "product-dev", "tags": [] }
                      ],
                      "todos": []
                    },
                    {
                      "id": "fp-002",
                      "name": "功能点二",
                      "clips": [
                        { "title": "剪藏二", "contentFile": "02-设计文档.md", "section": "## 功能点 fp-002", "category": "product-dev", "tags": [] }
                      ],
                      "todos": [
                        { "title": "待办二", "priority": "low", "status": "todo" }
                      ]
                    }
                  ],
                  "config": { "clipCategory": "product-dev", "todoCategory": "product-dev", "autoTag": "product-dev" }
                }
                """);

        TodoScannerService.ScanResult result = scanner.scanAndImport();
        assertEquals(1, result.clipsCreated(), "仅导入新增功能点的剪藏");
        assertEquals(1, result.todosCreated(), "仅导入新增功能点的待办");
        verify(clipService, times(2)).saveClip(any(ClipContent.class));

        List<TodoContent> todos = todoService.getAllTodos();
        assertEquals(1, todos.size());
        assertEquals("待办二", todos.get(0).getTitle());
    }

    @Test
    void handlesMissingRequirementGracefully() throws Exception {
        // requirement 缺失时降级为目录名，不抛异常
        Path dir = todoRoot.resolve("无元信息需求");
        Files.createDirectories(dir);
        Files.writeString(dir.resolve("feature-points.json"), """
                {
                  "featurePoints": [
                    {
                      "id": "fp-001",
                      "name": "功能点",
                      "clips": [
                        { "title": "剪藏", "contentFile": "02-设计文档.md", "category": "product-dev", "tags": [] }
                      ],
                      "todos": []
                    }
                  ]
                }
                """);
        Files.writeString(dir.resolve("02-设计文档.md"), "# 设计文档\n");

        TodoScannerService.ScanResult result = scanner.scanAndImport();
        assertEquals(1, result.clipsCreated());
        assertTrue(result.errors().isEmpty());
        ArgumentCaptor<ClipContent> captor = ArgumentCaptor.forClass(ClipContent.class);
        verify(clipService).saveClip(captor.capture());
        assertTrue(captor.getValue().getTags().contains("product-dev"));
    }
}
