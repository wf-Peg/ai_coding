import { useRef } from 'react';

function ImageUploader({ onImageAdd }) {
  const fileInputRef = useRef(null);

  const handleClick = () => {
    fileInputRef.current.click();
  };

  const handleFileChange = (e) => {
    const files = e.target.files;
    if (files.length > 0) {
      Array.from(files).forEach((file, index) => {
        handleImageFile(file, index + 1);
      });
    }
  };

  const handleImageFile = (file, index) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result;
      const timestamp = new Date().getTime();
      const extension = file.name.split('.').pop().toLowerCase();
      const fileName = `file-${timestamp}-${index}.${extension}`;

      // 通知父组件添加图片
      onImageAdd({ base64, fileName });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="image-uploader">
      <button 
        type="button" 
        className="upload-btn"
        onClick={handleClick}
      >
        📷 上传图片
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
      <div className="upload-tips">
        <span>支持批量上传图片</span>
      </div>
    </div>
  );
}

export default ImageUploader;