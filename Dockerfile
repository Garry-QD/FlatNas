# ==========================================
# 第一阶段：构建前端 (Builder Stage)
# ==========================================
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder

# 1. 接收构建参数（代理地址）
ARG HTTP_PROXY
ARG HTTPS_PROXY

WORKDIR /app

# 2. 设置环境变量
# 这样 npm install 就会自动走你传入的代理
ENV HTTP_PROXY=$HTTP_PROXY
ENV HTTPS_PROXY=$HTTPS_PROXY
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com

# 3. 安装依赖并构建
COPY package.json package-lock.json ./
RUN npm install

COPY . .
RUN npm run build-only


# ==========================================
# 第二阶段：生产环境 (Production Stage)
# ==========================================
FROM --platform=$TARGETPLATFORM node:20-alpine

# 1. 这里也需要接收参数，因为这一步也要 npm install
ARG HTTP_PROXY
ARG HTTPS_PROXY

WORKDIR /app

# 2. 同样配置代理环境变量
ENV HTTP_PROXY=$HTTP_PROXY
ENV HTTPS_PROXY=$HTTPS_PROXY
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
ENV NODE_ENV=production

# 3. 安装后端依赖
COPY package.json package-lock.json ./
# 此时 npm 会走你的 192.168... 代理，速度会非常快
RUN npm install --omit=dev

# 4. 拷贝文件
COPY server/ ./server/
COPY --from=builder /app/dist ./dist

# 5. 权限与启动
RUN chmod +x ./server/cgi-bin/*
EXPOSE 3000
CMD ["node", "server/server.js"]
