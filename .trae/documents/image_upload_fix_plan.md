# 图片上传功能修复计划

## 问题分析

### 1. 缩略图关闭按钮样式问题
- **现状**：缩略图的关闭按钮被button的min-width限制，导致按钮不是圆形
- **原因**：全局button样式可能设置了min-width，覆盖了.remove-btn的样式
- **解决方案**：在.remove-btn样式中添加min-width: unset来覆盖全局设置

### 2. 图片删除时正文内容未更新
- **现状**：当用户点击关闭按钮删除图片时，只从images状态中移除了图片，没有从content中删除对应的Markdown引用
- **原因**：handleImageRemove函数没有处理content的更新
- **解决方案**：修改handleImageRemove函数，在删除图片时同时从content中删除对应的Markdown引用

### 3. 后端图片存储路径问题
- **现状**：后端图片存储路径为`./clip-organized/{category}/assets/{noteFileName}/{fileName}`
- **需求**：需要存储到`./clip-organized/{当前分类}/{拼接的图片名路径}`，如`./clip-organized/study/assets/file-1776479347247-1.png`
- **解决方案**：修改ImageUtils中的存储路径生成逻辑

## 实现计划

### 1. 修复前端关闭按钮样式
- **文件**：`/workspace/frontend/src/App.css`
- **修改**：在.remove-btn样式中添加min-width: unset
- **步骤**：
  1. 打开App.css文件
  2. 在.remove-btn样式中添加min-width: unset
  3. 测试按钮样式是否正常显示为圆形

### 2. 修复图片删除时正文内容更新
- **文件**：`/workspace/frontend/src/components/ClipForm.jsx`
- **修改**：更新handleImageRemove函数，在删除图片时同时从content中删除对应的Markdown引用
- **步骤**：
  1. 打开ClipForm.jsx文件
  2. 修改handleImageRemove函数
  3. 添加逻辑，根据删除的图片fileName从content中删除对应的Markdown引用
  4. 测试删除图片时正文内容是否正确更新

### 3. 修复后端图片存储路径
- **文件**：`/workspace/backend/src/main/java/com/example/clip/utils/ImageUtils.java`
- **修改**：修改generateStoragePath和generateRelativePath方法
- **步骤**：
  1. 打开ImageUtils.java文件
  2. 修改generateStoragePath方法，简化存储路径
  3. 修改generateRelativePath方法，生成正确的相对路径
  4. 测试图片存储路径是否符合要求

## 技术细节

### 1. 前端关闭按钮样式修复
```css
.remove-btn {
  position: absolute;
  top: 5px;
  right: 5px;
  background-color: rgba(255, 0, 0, 0.8);
  color: white;
  border: none;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  min-width: unset; /* 添加这一行 */
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.3s ease;
}
```

### 2. 前端图片删除逻辑修复
```javascript
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
```

### 3. 后端图片存储路径修复
```java
// 修改generateStoragePath方法
private static Path generateStoragePath(String category, String noteFileName) {
    // 获取分类目录
    String categoryDir = getCategoryDir(category);
    
    // 构建完整路径：./clip-organized/{category}/assets
    return Paths.get(BASE_STORAGE_PATH, categoryDir, "assets");
}

// 修改generateRelativePath方法
private static String generateRelativePath(String category, String noteFileName, String fileName) {
    return "assets/" + fileName;
}
```

## 测试计划

1. **样式测试**：
   - 上传图片，检查缩略图的关闭按钮是否为圆形
   - 检查按钮是否正常显示和点击

2. **功能测试**：
   - 上传图片，检查正文内容是否自动添加Markdown引用
   - 点击关闭按钮删除图片，检查正文内容是否删除对应的Markdown引用
   - 提交剪藏，检查图片是否正确存储

3. **存储路径测试**：
   - 上传图片，检查图片是否存储到正确的路径
   - 检查存储路径是否符合`./clip-organized/{当前分类}/assets/{拼接的图片名路径}`格式

## 风险评估

- **前端样式风险**：修改CSS可能影响其他按钮的样式，需要确保只影响关闭按钮
- **前端逻辑风险**：修改handleImageRemove函数可能影响其他功能，需要测试所有图片相关操作
- **后端存储风险**：修改存储路径可能影响现有图片的访问，需要确保向后兼容

## 预期效果

- 缩略图的关闭按钮显示为圆形，不受min-width限制
- 点击关闭按钮删除图片时，正文内容中的Markdown引用也会被删除
- 图片存储路径符合要求，存储到`./clip-organized/{当前分类}/assets/{拼接的图片名路径}`

## 交付物

- 修改后的`App.css`文件
- 修改后的`ClipForm.jsx`文件
- 修改后的`ImageUtils.java`文件
- 测试结果报告