/**
 * 使用Canvas生成图标文件的脚本
 * 在浏览器中打开此HTML文件，点击按钮生成图标
 */

// 创建HTML内容
const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>生成浏览器扩展图标</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 50px auto;
            padding: 20px;
            text-align: center;
        }
        h1 { color: #3b82f6; }
        button {
            background: #3b82f6;
            color: white;
            border: none;
            padding: 15px 30px;
            font-size: 18px;
            border-radius: 8px;
            cursor: pointer;
            margin: 10px;
        }
        button:hover { background: #60a5fa; }
        #preview { margin: 30px 0; }
        .icon-preview { margin: 10px; display: inline-block; }
        .icon-preview img { display: block; margin-bottom: 5px; }
    </style>
</head>
<body>
    <h1>🖼️ 生成浏览器扩展图标</h1>
    <p>点击按钮生成并下载所需尺寸的图标文件</p>
    
    <button id="generateBtn">生成所有图标</button>
    
    <div id="preview"></div>
    
    <script>
        function generateIcon(size) {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            
            // 绘制背景
            const radius = size * 0.1875;
            ctx.beginPath();
            ctx.moveTo(radius, 0);
            ctx.lineTo(size - radius, 0);
            ctx.quadraticCurveTo(size, 0, size, radius);
            ctx.lineTo(size, size - radius);
            ctx.quadraticCurveTo(size, size, size - radius, size);
            ctx.lineTo(radius, size);
            ctx.quadraticCurveTo(0, size, 0, size - radius);
            ctx.lineTo(0, radius);
            ctx.quadraticCurveTo(0, 0, radius, 0);
            ctx.closePath();
            ctx.fillStyle = '#3b82f6';
            ctx.fill();
            
            // 绘制图标 (使用emoji或简单图形)
            ctx.font = size * 0.5 + 'px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('📝', size/2, size/2);
            
            return canvas;
        }
        
        function downloadIcon(canvas, size) {
            const link = document.createElement('a');
            link.download = 'icon-' + size + '.png';
            link.href = canvas.toDataURL('image/png');
            link.click();
        }
        
        function displayIcon(canvas, size) {
            const div = document.createElement('div');
            div.className = 'icon-preview';
            
            const img = document.createElement('img');
            img.src = canvas.toDataURL('image/png');
            img.style.width = '64px';
            img.style.height = '64px';
            img.style.border = '1px solid #ddd';
            img.style.borderRadius = '8px';
            
            const label = document.createElement('div');
            label.textContent = size + 'x' + size;
            label.style.fontSize = '12px';
            label.style.color = '#666';
            
            div.appendChild(img);
            div.appendChild(label);
            document.getElementById('preview').appendChild(div);
        }
        
        document.getElementById('generateBtn').addEventListener('click', function() {
            document.getElementById('preview').innerHTML = '';
            
            const sizes = [16, 32, 48, 128];
            sizes.forEach(size => {
                const canvas = generateIcon(size);
                displayIcon(canvas, size);
                downloadIcon(canvas, size);
            });
            
            this.textContent = '✅ 已下载图标';
            setTimeout(() => {
                this.textContent = '生成所有图标';
            }, 2000);
        });
        
        // 页面加载时预览
        window.addEventListener('load', function() {
            const canvas = generateIcon(128);
            displayIcon(canvas, 128);
        });
    </script>
</body>
</html>
`;

console.log('图标生成HTML已准备好');
console.log('请在浏览器中打开以下HTML内容，或保存为HTML文件');
console.log(htmlContent);
