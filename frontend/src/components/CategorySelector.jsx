import { useState, useEffect } from 'react';

function CategorySelector({ value, onChange }) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const response = await fetch('http://localhost:8080/api/clip/categories');
      if (response.ok) {
        const data = await response.json();
        setCategories(data);
      } else {
        throw new Error('Failed to fetch categories');
      }
    } catch (err) {
      setError(err.message);
      console.error('Error fetching categories:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="category-selector">加载分类中...</div>;
  }

  if (error) {
    return <div className="category-selector error">加载分类失败: {error}</div>;
  }

  return (
    <div className="category-selector">
      <select 
        value={value} 
        onChange={(e) => onChange(e.target.value)}
        className="category-select"
      >
        <option value="">默认AI匹配分类</option>
        {categories.map((category) => (
          <optgroup key={category.value} label={category.label}>
            {category.children && category.children.map((subCategory) => (
              <option key={subCategory.value} value={subCategory.value}>
                {subCategory.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

export default CategorySelector;