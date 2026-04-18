import { useState } from 'react';
import ContentInput from './ContentInput';
import ImageUploader from './ImageUploader';
import CategorySelector from './CategorySelector';

function ClipForm() {
  const [content, setContent] = useState('');
  const [images, setImages] = useState([]);
  const [type, setType] = useState('ai-text');
  const [category, setCategory] = useState('');
  const [source, setSource] = useState('manual');

  const handleContentChange = (newContent) => {
    setContent(newContent);
  };

  const handleImageAdd = (newImage) => {
    setImages([...images, newImage]);
  };

  const handleImageRemove = (index) => {
    const newImages = [...images];
    const removedImage = newImages.splice(index, 1)[0];
    setImages(newImages);
    
    // 从content中删除对应的Markdown引用
    if (removedImage) {
      const markdownRef = `![图片](assets/${removedImage.fileName})`;
      const newContent = content.replace(markdownRef, '');
      setContent(newContent);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      const formData = {
        content,
        type,
        source,
        category,
        imageDataList: images.map(img => ({
          base64Data: img.base64,
          fileName: img.fileName
        }))
      };

      const response = await fetch('http://localhost:8080/api/clip/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        const result = await response.json();
        alert('剪藏成功！ID: ' + result.id);
        // 重置表单
        setContent('');
        setImages([]);
        setType('ai-text');
        setCategory('');
        setSource('manual');
      } else {
        const error = await response.json();
        alert('剪藏失败: ' + (error.message || '未知错误'));
      }
    } catch (error) {
      console.error('提交失败:', error);
      alert('提交失败: ' + error.message);
    }
  };

  return (
    <div className="clip-form">
      <h2>添加剪藏</h2>
      
      <form onSubmit={handleSubmit}>
        {/* 内容输入 */}
        <div className="form-group">
          <label>内容</label>
          <ContentInput 
            value={content} 
            onChange={handleContentChange}
            onImageAdd={handleImageAdd}
          />
        </div>

        {/* 图片上传 */}
        <div className="form-group">
          <label>图片上传</label>
          <ImageUploader 
            onImageAdd={handleImageAdd}
          />
        </div>

        {/* 图片预览 */}
        {images.length > 0 && (
          <div className="image-previews">
            <h3>图片预览</h3>
            <div className="preview-grid">
              {images.map((img, index) => (
                <div key={index} className="preview-item">
                  <img src={img.base64} alt={`预览 ${index + 1}`} />
                  <button 
                    type="button" 
                    className="remove-btn"
                    onClick={() => handleImageRemove(index)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 剪藏类型 */}
        <div className="form-group">
          <label>剪藏类型</label>
          <select 
            value={type} 
            onChange={(e) => setType(e.target.value)}
            className="form-control"
          >
            <option value="ai-text">AI文本分析</option>
            <option value="store-only">仅存储</option>
            <option value="link-ai">链接AI分析</option>
            <option value="doc-ai">文档AI分析</option>
          </select>
        </div>

        {/* 来源 */}
        <div className="form-group">
          <label>来源</label>
          <select 
            value={source} 
            onChange={(e) => setSource(e.target.value)}
            className="form-control"
          >
            <option value="manual">手动输入</option>
            <option value="browser">浏览器</option>
            <option value="system">系统文件</option>
            <option value="clipboard">剪贴板</option>
          </select>
        </div>

        {/* 分类选择 */}
        <div className="form-group">
          <label>分类</label>
          <CategorySelector 
            value={category} 
            onChange={setCategory}
          />
        </div>

        {/* 提交按钮 */}
        <button type="submit" className="submit-btn">
          添加剪藏
        </button>
      </form>
    </div>
  );
}

export default ClipForm;