package com.example.clip.service;

import com.example.clip.model.TodoItem;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

@Service
public class TodoItemService {

    private final ObjectMapper objectMapper;
    private final Path storagePath;
    private final AtomicLong idGenerator = new AtomicLong(1);
    private static final DateTimeFormatter DATE_FORMATTER = DateTimeFormatter.ofPattern("yyMMdd");
    private static final String TODO_LIST_DIR = "todoList";

    public TodoItemService(@Value("${clip.storage.path:./clip-storage}") String storagePath) {
        this.objectMapper = new ObjectMapper();
        this.objectMapper.registerModule(new JavaTimeModule());
        this.objectMapper.configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        this.storagePath = Paths.get(storagePath);
        initStorage();
        initIdGenerator();
    }

    private void initStorage() {
        try {
            Path todoListPath = storagePath.resolve(TODO_LIST_DIR);
            if (!Files.exists(todoListPath)) {
                Files.createDirectories(todoListPath);
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    private void initIdGenerator() {
        try {
            long maxId = 0;
            List<Path> jsonFiles = getAllTodoFiles();
            for (Path path : jsonFiles) {
                List<TodoItem> todos = readTodoArrayFromFile(path);
                for (TodoItem todo : todos) {
                    if (todo.getId() != null && todo.getId() > maxId) {
                        maxId = todo.getId();
                    }
                }
            }
            idGenerator.set(maxId + 1);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private Path getTodoListPath() {
        return storagePath.resolve(TODO_LIST_DIR);
    }

    private Path getDateFilePath(String category) {
        String dateStr = LocalDate.now().format(DATE_FORMATTER);
        String fileName = dateStr;
        if (category != null && !category.isEmpty()) {
            fileName = dateStr + "_" + category;
        }
        return getTodoListPath().resolve(fileName + ".json");
    }

    private List<Path> getAllTodoFiles() throws IOException {
        List<Path> files = new ArrayList<>();
        Path todoListPath = getTodoListPath();
        if (!Files.exists(todoListPath)) {
            return files;
        }
        Files.walk(todoListPath)
                .filter(Files::isRegularFile)
                .filter(path -> path.toString().endsWith(".json"))
                .forEach(files::add);
        return files;
    }

    private List<TodoItem> readTodoArrayFromFile(Path path) {
        try {
            if (!Files.exists(path)) {
                return new ArrayList<>();
            }
            String content = Files.readString(path);
            if (content == null || content.trim().isEmpty()) {
                return new ArrayList<>();
            }
            return objectMapper.readValue(content, new TypeReference<List<TodoItem>>() {});
        } catch (IOException e) {
            e.printStackTrace();
            return new ArrayList<>();
        }
    }

    private void writeTodoArrayToFile(Path path, List<TodoItem> todos) {
        try {
            Path parent = path.getParent();
            if (!Files.exists(parent)) {
                Files.createDirectories(parent);
            }
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(path.toFile(), todos);
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    public TodoItem saveTodo(TodoItem todo) {
        try {
            if (todo.getId() == null) {
                todo.setId(idGenerator.getAndIncrement());
            }
            todo.setUpdatedAt(java.time.LocalDateTime.now());

            String category = todo.getCategory();
            Path filePath = getDateFilePath(category);
            List<TodoItem> todos = readTodoArrayFromFile(filePath);

            boolean updated = false;
            for (int i = 0; i < todos.size(); i++) {
                if (todos.get(i).getId() != null && todos.get(i).getId().equals(todo.getId())) {
                    todos.set(i, todo);
                    updated = true;
                    break;
                }
            }

            if (!updated) {
                todos.add(todo);
            }

            writeTodoArrayToFile(filePath, todos);
            return todo;
        } catch (Exception e) {
            e.printStackTrace();
            return null;
        }
    }

    public List<TodoItem> getAllTodos() {
        List<TodoItem> allTodos = new ArrayList<>();
        try {
            List<Path> jsonFiles = getAllTodoFiles();
            for (Path path : jsonFiles) {
                List<TodoItem> todos = readTodoArrayFromFile(path);
                allTodos.addAll(todos);
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
        return allTodos;
    }

    public List<TodoItem> getTodosByDate(String dateStr) {
        List<TodoItem> todos = new ArrayList<>();
        try {
            Path todoListPath = getTodoListPath();
            if (!Files.exists(todoListPath)) {
                return todos;
            }
            Files.walk(todoListPath)
                    .filter(Files::isRegularFile)
                    .filter(path -> path.getFileName().toString().startsWith(dateStr))
                    .forEach(path -> {
                        List<TodoItem> fileTodos = readTodoArrayFromFile(path);
                        todos.addAll(fileTodos);
                    });
        } catch (IOException e) {
            e.printStackTrace();
        }
        return todos;
    }

    public TodoItem getTodoById(Long id) {
        try {
            List<Path> jsonFiles = getAllTodoFiles();
            for (Path path : jsonFiles) {
                List<TodoItem> todos = readTodoArrayFromFile(path);
                for (TodoItem todo : todos) {
                    if (todo.getId() != null && todo.getId().equals(id)) {
                        return todo;
                    }
                }
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
        return null;
    }

    public void deleteTodo(Long id) {
        try {
            List<Path> jsonFiles = getAllTodoFiles();
            for (Path path : jsonFiles) {
                List<TodoItem> todos = readTodoArrayFromFile(path);
                boolean found = false;

                Iterator<TodoItem> iterator = todos.iterator();
                while (iterator.hasNext()) {
                    TodoItem todo = iterator.next();
                    if (todo.getId() != null && todo.getId().equals(id)) {
                        iterator.remove();
                        found = true;
                        break;
                    }
                }

                if (found) {
                    writeTodoArrayToFile(path, todos);
                    break;
                }
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    public List<TodoItem> getTodosByCategory(String category) {
        List<TodoItem> todos = new ArrayList<>();
        try {
            String categorySuffix = "_" + category + ".json";
            Path todoListPath = getTodoListPath();
            if (!Files.exists(todoListPath)) {
                return todos;
            }
            Files.walk(todoListPath)
                    .filter(Files::isRegularFile)
                    .filter(path -> path.getFileName().toString().endsWith(categorySuffix))
                    .forEach(path -> {
                        List<TodoItem> fileTodos = readTodoArrayFromFile(path);
                        todos.addAll(fileTodos);
                    });
        } catch (IOException e) {
            e.printStackTrace();
        }
        return todos;
    }
}
