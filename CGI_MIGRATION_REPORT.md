# CGI 改造报告

## 1. 扫描结果

通过全面扫描项目目录，发现以下潜在 CGI 脚本：

*   **应用脚本**: `d:\FlatNas\server\cgi-bin\index.cgi` (Node.js)
*   **依赖库脚本**:
    *   `node_modules/flatted/python/flatted.py` (库内部使用，忽略)
    *   `node_modules/flatted/php/flatted.php` (库内部使用，忽略)
    *   `node_modules/shell-quote/print.py` (库内部使用，忽略)
    *   `node_modules/bcrypt/build-all.sh` (构建脚本，忽略)
    *   `node_modules/rss-parser/scripts/build.sh` (构建脚本，忽略)

**结论**: 项目中实际使用的 CGI 脚本仅有 `index.cgi`，且已经是 Node.js 编写。

## 2. 改造内容

### 问题分析
原 `server.js` 使用 `spawn('node', [cgiScript])` 方式调用 CGI 脚本。但在项目启用 ESM (`"type": "module"`) 模式下，Node.js 默认拒绝加载非标准扩展名 (`.cgi`) 的文件作为模块，导致调用失败（报错 `ERR_UNKNOWN_FILE_EXTENSION`）。

### 解决方案
修改 `server.js` 中的 CGI 调用逻辑，使用 `-r` (require) 参数配合 `-e` (eval) 来预加载并执行 CGI 脚本。这种方式允许 Node.js 将 `.cgi` 文件作为 CommonJS 模块加载，绕过了 ESM 加载器对扩展名的限制。

**修改前**:
```javascript
const child = spawn('node', [cgiScript], { env })
```

**修改后**:
```javascript
const child = spawn('node', ['-r', cgiScript, '-e', '0'], { env })
```

### 验证结果
通过 `curl` 测试验证，CGI 接口已恢复正常：
```
GET http://localhost:3000/cgi-bin/index.cgi?name=test&val=123
Status: 200 OK
Response: {"method":"GET","message":"GET 请求处理成功",...}
```

## 3. 回滚方案

如果需要回滚到修改前的状态，请执行以下操作：

1.  打开 `d:\FlatNas\server\server.js`
2.  找到第 405 行左右的 `spawn` 调用
3.  将代码恢复为：
    ```javascript
    const child = spawn('node', [cgiScript], { env })
    ```
4.  重启服务器

注意：回滚后 `index.cgi` 将再次因扩展名问题无法被 Node.js 直接执行，除非将项目改为 CommonJS 模式或重命名文件为 `.js`。
