# --- 第一阶段：构建前端 (Build Stage) ---
    FROM node:20-alpine AS builder

    WORKDIR /app
    
    # 先把依赖文件拷进去装依赖 (利用缓存加速)
    COPY package.json package-lock.json ./
    # 安装所有依赖 (包括前端构建工具)
    RUN npm install
    
    # 把所有源代码拷进去
    COPY . .
    
    # 执行构建命令 -> 生成 dist 文件夹
    RUN npm run build
    
    # --- 第二阶段：生产环境 (Production Stage) ---
    # 我们只用一个轻量级的 Node 镜像来运行
    FROM node:20-alpine
    
    WORKDIR /app
    
    # 1. 只拷贝后端运行需要的关键文件
    COPY server/package.json ./server/
    COPY server/server.js ./server/
    
    # 2. 拷贝第一阶段构建好的前端静态文件
    COPY --from=builder /app/dist ./dist
    
    # 3. 安装后端仅需的依赖 (express, cors)
    # 这里的技巧是：进入 server 目录单独安装，避免把前端的一堆大包带进来
    WORKDIR /app/server
    RUN npm install express cors
    
    # 安装 Python3 以支持 CGI 脚本
    RUN apk add --no-cache python3
    
    # 4. 暴露端口
    EXPOSE 3000
    
    # 5. 启动命令
    CMD ["node", "server.js"]