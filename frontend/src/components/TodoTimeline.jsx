import { useState, useEffect } from 'react';

function TodoTimeline() {
  const [todos, setTodos] = useState([]);
  const [newTodo, setNewTodo] = useState('');
  const [newDeadline, setNewDeadline] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchTodos();
  }, []);

  const fetchTodos = async () => {
    try {
      const response = await fetch('http://localhost:8080/api/todo/list');
      if (response.ok) {
        const data = await response.json();
        setTodos(data);
      }
    } catch (error) {
      console.error('获取待办事项失败:', error);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    return `${year}年${month}月${day}日`;
  };

  const formatDeadlineForDisplay = (deadline) => {
    if (!deadline) return '';
    const date = new Date(deadline);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  };

  const groupTodosByDate = (todoList) => {
    const groups = {};
    todoList.forEach(todo => {
      const dateKey = formatDeadlineForDisplay(todo.deadline) || '无日期';
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(todo);
    });
    return groups;
  };

  const getSortedDates = (groups) => {
    return Object.keys(groups).sort((a, b) => {
      if (a === '无日期') return 1;
      if (b === '无日期') return -1;
      return a.localeCompare(b);
    });
  };

  const handleAddTodo = async (e) => {
    e.preventDefault();
    if (!newTodo.trim() || !newDeadline.trim()) {
      alert('请填写待办事项和截止日期');
      return;
    }

    setLoading(true);
    try {
      const year = newDeadline.substring(0, 4);
      const month = newDeadline.substring(4, 6);
      const day = newDeadline.substring(6, 8);
      const deadlineDate = new Date(year, month - 1, day);

      const todoData = {
        content: newTodo,
        category: newCategory || '默认',
        deadline: deadlineDate.toISOString()
      };

      const response = await fetch('http://localhost:8080/api/todo/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(todoData)
      });

      if (response.ok) {
        setNewTodo('');
        setNewDeadline('');
        setNewCategory('');
        fetchTodos();
      } else {
        alert('添加失败');
      }
    } catch (error) {
      console.error('添加待办事项失败:', error);
      alert('添加失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleComplete = async (todo) => {
    try {
      const updatedTodo = {
        ...todo,
        completed: !todo.completed
      };

      const response = await fetch('http://localhost:8080/api/todo/update', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updatedTodo)
      });

      if (response.ok) {
        fetchTodos();
      }
    } catch (error) {
      console.error('更新待办事项失败:', error);
    }
  };

  const handleDeleteTodo = async (id) => {
    if (!confirm('确定要删除这个待办事项吗？')) return;

    try {
      const response = await fetch(`http://localhost:8080/api/todo/${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        fetchTodos();
      }
    } catch (error) {
      console.error('删除待办事项失败:', error);
    }
  };

  const groups = groupTodosByDate(todos);
  const sortedDates = getSortedDates(groups);

  return (
    <div className="todo-timeline">
      <h2>待办事项时间线</h2>
      
      <form onSubmit={handleAddTodo} className="todo-form">
        <div className="form-row">
          <div className="form-group">
            <label>截止日期 (yyyymmdd)</label>
            <input
              type="text"
              value={newDeadline}
              onChange={(e) => setNewDeadline(e.target.value)}
              placeholder="例如: 20260416"
              className="form-control"
              maxLength={8}
            />
          </div>
          <div className="form-group">
            <label>分类</label>
            <input
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="例如: 工作"
              className="form-control"
            />
          </div>
        </div>
        <div className="form-group">
          <label>待办事项</label>
          <input
            type="text"
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            placeholder="请输入待办事项"
            className="form-control"
          />
        </div>
        <button type="submit" className="submit-btn" disabled={loading}>
          {loading ? '添加中...' : '添加待办'}
        </button>
      </form>

      <div className="timeline-container">
        {sortedDates.map((dateKey) => (
          <div key={dateKey} className="timeline-date-group">
            <div className="timeline-date-header">
              <span className="date-label">
                {dateKey === '无日期' ? '无日期' : formatDate(dateKey)}
              </span>
              <span className="todo-count">
                ({groups[dateKey].length}项)
              </span>
            </div>
            <div className="timeline-items">
              {groups[dateKey].map((todo) => (
                <div 
                  key={todo.id} 
                  className={`timeline-item ${todo.completed ? 'completed' : ''}`}
                >
                  <div className="timeline-dot"></div>
                  <div className="timeline-content">
                    <div className="todo-header">
                      <input
                        type="checkbox"
                        checked={todo.completed}
                        onChange={() => handleToggleComplete(todo)}
                        className="todo-checkbox"
                      />
                      <span className="todo-text">{todo.content}</span>
                      <button
                        type="button"
                        className="delete-btn"
                        onClick={() => handleDeleteTodo(todo.id)}
                      >
                        ×
                      </button>
                    </div>
                    {todo.category && (
                      <span className="todo-category">{todo.category}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {sortedDates.length === 0 && (
          <div className="empty-state">
            <p>暂无待办事项，开始添加吧！</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default TodoTimeline;
