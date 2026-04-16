import { useRef } from 'react';

function ContentInput({ value, onChange, onImageAdd }) {
  const textareaRef = useRef(null);

  const handlePaste = (e) => {
    const items = e.clipboardData.items;
    
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        const file = items[i].getAsFile();
        handleImageFile(file);
        break;
      }
    }
  };

  const handleImageFile = (file) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result;
      const timestamp = new Date().getTime();
      // 确保文件扩展名正确处理
      const extension = file.name ? file.name.split('.').pop().toLowerCase() : 'png';
      const fileName = `file-${timestamp}-1.${extension}`;

      // 生成Markdown引用
      const markdownRef = `![图片](assets/${fileName})`;
      
      // 更新内容，在光标位置插入Markdown引用
      const textarea = textareaRef.current;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newContent = value.substring(0, start) + markdownRef + value.substring(end);
      
      onChange(newContent);
      
      // 通知父组件添加图片
      onImageAdd({ base64, fileName });
    };
    reader.readAsDataURL(file);
  };

  const handleChange = (e) => {
    onChange(e.target.value);
  };

  return (
    <div className="content-input">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onPaste={handlePaste}
        placeholder="输入剪藏内容，支持粘贴图片..."
        rows={6}
        className="content-textarea"
      />
      <div className="input-tips">
        <span>💡 提示：可直接粘贴图片到输入框</span>
      </div>
    </div>
  );
}

export default ContentInput;