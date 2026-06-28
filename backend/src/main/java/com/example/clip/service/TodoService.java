package com.example.clip.service;

import com.example.clip.model.TodoContent;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 待办事项业务服务
 * <p>
 * 提供待办事项的增删改查（CRUD）操作，作为业务逻辑层封装了底层 {@link FileStorageService} 的调用。
 * 所有持久化操作最终委托给 FileStorageService 完成，本层负责业务校验和流程编排。
 * </p>
 *
 * @see FileStorageService
 */
@Service
public class TodoService {

    /** 底层文件存储服务，负责待办事项的 JSON 文件持久化 */
    private final FileStorageService storageService;

    /**
     * 构造器注入
     *
     * @param storageService 文件存储服务实例（由 Spring 容器自动注入）
     */
    public TodoService(FileStorageService storageService) {
        this.storageService = storageService;
    }

    /**
     * 保存待办事项（新增或更新）
     * <p>
     * 如果待办事项的 id 为 null，则视为新增，由底层自动生成 ID；
     * 如果 id 已存在，则视为更新，会先删除旧记录再写入新记录。
     * </p>
     *
     * @param todo 待保存的待办事项对象
     * @return 保存后的待办事项（包含自动生成的 ID）
     */
    public TodoContent saveTodo(TodoContent todo) {
        return storageService.saveTodo(todo);
    }

    /**
     * 获取所有待办事项
     * <p>
     * 遍历 todoList 目录下所有 JSON 文件，读取并合并所有待办事项。
     * </p>
     *
     * @return 所有待办事项的列表（可能为空列表）
     */
    public List<TodoContent> getAllTodos() {
        return storageService.getAllTodos();
    }

    /**
     * 根据 ID 获取单个待办事项
     *
     * @param id 待办事项的唯一标识
     * @return 匹配的待办事项；若未找到则返回 null
     */
    public TodoContent getTodoById(Long id) {
        return storageService.getTodoById(id);
    }

    /**
     * 删除待办事项
     * <p>
     * 遍历所有待办事项文件，移除匹配 ID 的记录并回写文件。
     * </p>
     *
     * @param id 待删除的待办事项 ID
     */
    public void deleteTodo(Long id) {
        storageService.deleteTodo(id);
    }

    /**
     * 更新待办事项的完成状态
     * <p>
     * 先根据 ID 查询待办事项，若存在则修改其 completed 字段并保存。
     * </p>
     *
     * @param id        待办事项 ID
     * @param completed 新的完成状态（true=已完成，false=未完成）
     * @return 更新后的待办事项；若未找到则返回 null
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
     * 更新待办事项的全部字段
     * <p>
     * 直接调用底层保存方法，底层会根据 ID 判断是新增还是更新。
     * </p>
     *
     * @param todo 包含更新后字段的待办事项对象（必须包含有效 ID）
     * @return 更新后的待办事项
     */
    public TodoContent updateTodo(TodoContent todo) {
        return storageService.saveTodo(todo);
    }
}