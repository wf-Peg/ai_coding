package com.example.clip.controller;

import com.example.clip.model.TodoContent;
import com.example.clip.service.TodoService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 待办事项控制器类
 */
@RestController
@RequestMapping("/api/todo")
@CrossOrigin(origins = "*")  // 允许所有跨域请求，包括浏览器扩展
public class TodoController {

    private static final Logger log = LoggerFactory.getLogger(TodoController.class);
    private final TodoService todoService;

    /**
     * 构造函数
     * @param todoService 待办事项服务
     */
    public TodoController(TodoService todoService) {
        this.todoService = todoService;
    }

    /**
     * 获取所有待办事项
     * @return 待办事项列表
     */
    @GetMapping("/list")
    public ResponseEntity<List<TodoContent>> getTodoList() {
        List<TodoContent> todos = todoService.getAllTodos();
        return ResponseEntity.ok(todos);
    }

    /**
     * 根据ID获取待办事项
     * @param id 待办事项ID
     * @return 待办事项
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
     * 添加待办事项
     * @param todo 待办事项
     * @return 保存后的待办事项
     */
    @PostMapping("/add")
    public ResponseEntity<TodoContent> addTodo(@RequestBody TodoContent todo) {
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
            log.error("[API] Exception while saving todo", e);
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * 更新待办事项
     * @param todo 待办事项
     * @return 更新后的待办事项
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
     * @param id 待办事项ID
     * @return 响应
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteTodo(@PathVariable Long id) {
        todoService.deleteTodo(id);
        return ResponseEntity.ok().build();
    }

    /**
     * 更新待办事项状态
     * @param id 待办事项ID
     * @param completed 完成状态
     * @return 更新后的待办事项
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