package com.example.clip.controller;

import com.example.clip.model.TodoItem;
import com.example.clip.service.TodoItemService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/todo")
@CrossOrigin(origins = {"http://127.0.0.1:3000", "http://localhost:3000", "http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:3001", "http://localhost:3001"})
public class TodoController {

    private static final Logger log = LoggerFactory.getLogger(TodoController.class);
    private final TodoItemService todoItemService;

    @Autowired
    public TodoController(TodoItemService todoItemService) {
        this.todoItemService = todoItemService;
    }

    @PostMapping("/add")
    public ResponseEntity<?> addTodo(@RequestBody TodoItem todo) {
        log.info("[API] /todo/add called, content={}", todo.getContent());
        TodoItem savedTodo = todoItemService.saveTodo(todo);
        return ResponseEntity.ok(new TodoResponse(savedTodo.getId(), "success"));
    }

    @PutMapping("/update")
    public ResponseEntity<?> updateTodo(@RequestBody TodoItem todo) {
        log.info("[API] /todo/update called, id={}", todo.getId());
        TodoItem existingTodo = todoItemService.getTodoById(todo.getId());
        if (existingTodo == null) {
            return ResponseEntity.notFound().build();
        }
        TodoItem updatedTodo = todoItemService.saveTodo(todo);
        return ResponseEntity.ok(new TodoResponse(updatedTodo.getId(), "success"));
    }

    @GetMapping("/list")
    public ResponseEntity<List<TodoItem>> getTodoList() {
        List<TodoItem> todos = todoItemService.getAllTodos();
        return ResponseEntity.ok(todos);
    }

    @GetMapping("/date/{dateStr}")
    public ResponseEntity<List<TodoItem>> getTodosByDate(@PathVariable(name = "dateStr") String dateStr) {
        List<TodoItem> todos = todoItemService.getTodosByDate(dateStr);
        return ResponseEntity.ok(todos);
    }

    @GetMapping("/category/{category}")
    public ResponseEntity<List<TodoItem>> getTodosByCategory(@PathVariable(name = "category") String category) {
        List<TodoItem> todos = todoItemService.getTodosByCategory(category);
        return ResponseEntity.ok(todos);
    }

    @GetMapping("/{id}")
    public ResponseEntity<TodoItem> getTodoById(@PathVariable(name = "id") Long id) {
        TodoItem todo = todoItemService.getTodoById(id);
        if (todo == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(todo);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteTodo(@PathVariable(name = "id") Long id) {
        todoItemService.deleteTodo(id);
        return ResponseEntity.ok(new TodoResponse(null, "success"));
    }

    public static class TodoResponse {
        private Long id;
        private String status;

        public TodoResponse(Long id, String status) {
            this.id = id;
            this.status = status;
        }

        public Long getId() {
            return id;
        }

        public void setId(Long id) {
            this.id = id;
        }

        public String getStatus() {
            return status;
        }

        public void setStatus(String status) {
            this.status = status;
        }
    }
}
