# --- 第一阶段：构建前端 (Builder Stage) ---
FROM docker.m.daocloud.io/library/node:20-alpine AS builder

WORKDIR /app

# 1. 安装项目依赖
# 利用缓存层，如果 package.json 没变，就不重新 npm install
COPY package.json package-lock.json ./
RUN npm install

# 2. 拷贝所有源代码
COPY . .

# 3. 执行构建生成 dist 目录
RUN npm run build-only


# --- 第二阶段：生产环境 (Production Stage) ---
# 我们只用一个轻量级的 Node 镜像来运行，不包含 Python，体积更小
FROM docker.m.daocloud.io/library/node:20-alpine

WORKDIR /app

# 1. 安装生产环境依赖
# 由于 server 目录没有 package.json，我们使用根目录的 package.json
# 这里的依赖包含 express, cors 等后端需要的包
COPY package.json package-lock.json ./
RUN npm install --omit=dev

# 2. 准备后端文件结构
COPY server/ ./server/

# 3. 拷贝构建好的前端静态文件
COPY --from=builder /app/dist ./dist

# 4. 处理 CGI 权限
# 赋予 cgi-bin 下所有文件可执行权限，确保 spawn 能调用
RUN chmod +x ./server/cgi-bin/*

# 5. 暴露端口
EXPOSE 3000

# 6. 启动 Node.js 网关服务
# server.js 位于 /app/server/server.js
CMD ["node", "server/server.js"]
