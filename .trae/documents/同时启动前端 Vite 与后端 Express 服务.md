## 执行目标
- 在 `d:\Flat-Nav\flat-nav` 目录启动前端开发服务：`npm run dev`（Vite，默认端口 `5173`）。
- 在同一目录启动后端服务：`node server/server.js`（Express，端口 `3000`）。
- 并行运行于两个独立终端，避免互相抢占；分别监控启动日志并捕获早期错误。

## 前置检查
- Node 版本满足 `package.json` engines：`^20.19.0 || >=22.12.0`。
- 如缺少依赖，自动执行 `npm install`（或 `npm ci`）一次以确保 `vite`、`@vitejs/plugin-vue` 等可用。
- 运行目录均为 `d:\Flat-Nav\flat-nav`，保证相对路径（如 `server/server.js`、`dist/`）正确。

## 执行步骤
1. 在终端A（非阻塞）运行：`npm run dev`
   - 期望输出包含 `Local: http://localhost:5173/`。
   - 若端口占用，Vite会提示换端口；记录最终预览 URL。
2. 在终端B（非阻塞）运行：`node server/server.js`
   - 期望输出：`Server running at http://localhost:3000`。
   - 服务将提供 `/api/*` 接口与静态 `dist/` 文件（生产预览路径）。

## 验证与可视化
- 捕获两个命令的启动日志；若出现错误（端口占用、依赖缺失、语法错误），根据输出进行即时修复（如改端口、安装依赖）。
- 成功后提供可点击的预览 URL：
  - 前端（开发热更新）：`http://localhost:5173/`
  - 后端（API/静态托管）：`http://localhost:3000/`

## 故障处理
- 依赖缺失：执行 `npm install` 后重试。
- 端口占用：记录冲突端口并按提示切换；必要时设置 `VITE_PORT` 或 `--port` 参数。
- Node 版本不符：提示升级至 Node 20+。

## 交付
- 启动两个服务并返回预览 URL；确保能访问首页与 `/api/data` 等接口。