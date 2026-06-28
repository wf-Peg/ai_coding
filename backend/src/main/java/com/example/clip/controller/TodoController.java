package com.example.clip.controller;

import com.example.clip.model.TodoContent;
import com.example.clip.service.TodoService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 待办事项 REST 控制器
 * <p>
 * 提供待办事项（Todo）的 CRUD 操作接口，包括：
 * <ul>
 *   <li>获取全部待办列表</li>
 *   <li>按 ID 获取单个待办</li>
 *   <li>新增待办事项</li>
 *   <li>更新待办事项内容</li>
 *   <li>删除待办事项</li>
 *   <li>更新待办完成状态</li>
 * </ul>
 * 所有接口均映射到 {@code /api/todo} 路径下，并允许跨域访问。
 * </p>
 *
 * @see TodoService
 */
@RestController
@RequestMapping("/api/todo")
@CrossOrigin(origins = "*")  // 允许所有来源的跨域请求，包括浏览器扩展
public class TodoController {

    private static final Logger log = LoggerFactory.getLogger(TodoController.class);

    /** 待办事项核心业务服务 */
    private final TodoService todoService;

    /**
     * 构造函数，通过依赖注入初始化服务组件
     *
     * @param todoService 待办事项服务
     */
    public TodoController(TodoService todoService) {
        this.todoService = todoService;
    }

    /**
     * 获取所有待办事项列表
     * <p>
     * GET /api/todo/list
     *
     * @return 全部待办事项列表
     */
    @GetMapping("/list")
    public ResponseEntity<List<TodoContent>> getTodoList() {
        List<TodoContent> todos = todoService.getAllTodos();
        return ResponseEntity.ok(todos);
    }

    /**
     * 根据 ID 获取单个待办事项
     * <p>
     * GET /api/todo/{id}
     *
     * @param id 待办事项 ID
     * @return 待办事项实体；若不存在则返回 404
     */
    @GetMapping("/{id}")
    public ResponseEntity<TodoContent> getTodoById(@PathVariable Long id) {
        TodoContent todo = todoService.getTodoById(id);
        if (todo != null) {
            return ResponseEntity.ok(todo);
        } else {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * 新增待办事项
     * <p>
     * POST /api/todo/add
     * <p>
     * 保存一条新的待办事项。记录请求日志便于排查问题。
     *
     * @param todo 待办事项实体（由前端 JSON 反序列化）
     * @return 保存后的待办事项（含自动生成的 ID）；若保存失败或异常则返回 400
     */
    @PostMapping("/add")
    public ResponseEntity<TodoContent> addTodo(@RequestBody TodoContent todo) {
        // 记录关键字段，便于追踪请求
        log.info("[API] /add called with todo: title={}, priority={}, deadline={}, completed={}, category={}",
            todo.getTitle(), todo.getPriority(), todo.getDeadline(), todo.isCompleted(), todo.getCategory());
        try {
            TodoContent savedTodo = todoService.saveTodo(todo);
            if (savedTodo != null) {
                log.info("[API] Todo saved successfully: id={}", savedTodo.getId());
                return ResponseEntity.ok(savedTodo);
            } else {
                log.error("[API] Failed to save todo, savedTodo is null");
                return ResponseEntity.badRequest().build();
            }
        } catch (Exception e) {
            // 捕获所有异常，避免向客户端暴露内部错误详情
            log.error("[API] Exception while saving todo", e);
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * 更新待办事项
     * <p>
     * PUT /api/todo/update
     * <p>
     * 根据待办实体的 ID 进行全量更新。注意：此接口使用请求体中的 ID 定位记录。
     *
     * @param todo 包含更新后字段的待办事项实体（必须包含有效的 ID）
     * @return 更新后的待办事项；若记录不存在则返回 400
     */
    @PutMapping("/update")
    public ResponseEntity<TodoContent> updateTodo(@RequestBody TodoContent todo) {
        TodoContent updatedTodo = todoService.updateTodo(todo);
        if (updatedTodo != null) {
            return ResponseEntity.ok(updatedTodo);
        } else {
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * 删除待办事项
     * <p>
     * DELETE /api/todo/{id}
     *
     * @param id 待办事项 ID
     * @return 200 OK（空响应体）
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteTodo(@PathVariable Long id) {
        todoService.deleteTodo(id);
        return ResponseEntity.ok().build();
    }

    /**
     * 更新待办事项的完成状态
     * <p>
     * PUT /api/todo/{id}/status?completed=true
     * <p>
     * 仅更新待办事项的 completed 字段，不修改其他内容。
     * 这是切换完成/未完成状态的快捷接口。
     *
     * @param id        待办事项 ID
     * @param completed 目标完成状态（true=已完成，false=未完成）
     * @return 更新后的待办事项；若记录不存在则返回 404
     */
    @PutMapping("/{id}/status")
    public ResponseEntity<TodoContent> updateTodoStatus(@PathVariable Long id, @RequestParam boolean completed) {
        TodoContent updatedTodo = todoService.updateTodoStatus(id, completed);
        if (updatedTodo != null) {
            return ResponseEntity.ok(updatedTodo);
        } else {
            return ResponseEntity.notFound().build();
        }
    }
}