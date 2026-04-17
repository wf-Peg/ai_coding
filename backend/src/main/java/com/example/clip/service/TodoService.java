package com.example.clip.service;

import com.example.clip.model.TodoContent;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 待办事项服务类
 */
@Service
public class TodoService {

    private final FileStorageService storageService;

    /**
     * 构造函数
     * @param storageService 文件存储服务
     */
    public TodoService(FileStorageService storageService) {
        this.storageService = storageService;
    }

    /**
     * 保存待办事项
     * @param todo 待办事项
     * @return 保存后的待办事项
     */
    public TodoContent saveTodo(TodoContent todo) {
        return storageService.saveTodo(todo);
    }

    /**
     * 获取所有待办事项
     * @return 待办事项列表
     */
    public List<TodoContent> getAllTodos() {
        return storageService.getAllTodos();
    }

    /**
     * 根据ID获取待办事项
     * @param id 待办事项ID
     * @return 待办事项
     */
    public TodoContent getTodoById(Long id) {
        return storageService.getTodoById(id);
    }

    /**
     * 删除待办事项
     * @param id 待办事项ID
     */
    public void deleteTodo(Long id) {
        storageService.deleteTodo(id);
    }

    /**
     * 更新待办事项状态
     * @param id 待办事项ID
     * @param completed 完成状态
     * @return 更新后的待办事项
     */
    public TodoContent updateTodoStatus(Long id, boolean completed) {
        TodoContent todo = storageService.getTodoById(id);
        if (todo != null) {
            todo.setCompleted(completed);
            return storageService.saveTodo(todo);
        }
        return null;
    }

    /**
     * 更新待办事项
     * @param todo 待办事项
     * @return 更新后的待办事项
     */
    public TodoContent updateTodo(TodoContent todo) {
        return storageService.saveTodo(todo);
    }
}