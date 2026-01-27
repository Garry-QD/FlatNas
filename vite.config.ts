import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueDevTools from "vite-plugin-vue-devtools";
import compression from "vite-plugin-compression";

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: "/",
  plugins: [
    vue(),
    mode === "development" && vueDevTools(),
    // Gzip 压缩
    mode === "production" &&
      compression({
        algorithm: "gzip",
        ext: ".gz",
        threshold: 1024, // 只压缩大于 1KB 的文件
        deleteOriginFile: false,
      }),
    // Brotli 压缩 (更好的压缩率)
    mode === "production" &&
      compression({
        algorithm: "brotliCompress",
        ext: ".br",
        threshold: 1024,
        deleteOriginFile: false,
      }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    // 启用 minify
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true, // 生产环境移除 console
        drop_debugger: true,
      },
    },
    // 代码分割策略
    rollupOptions: {
      output: {
        // 手动分包 - 将大型依赖分离
        manualChunks: {
          // Vue 核心
          "vue-vendor": ["vue", "vue-router", "pinia"],
          // UI 相关
          "ui-vendor": ["grid-layout-plus", "vue-draggable-plus", "@vueuse/core"],
          // 工具库
          "utils-vendor": ["socket.io-client", "fuse.js", "xlsx"],
        },
        // 优化 chunk 文件名
        chunkFileNames: "assets/js/[name]-[hash].js",
        entryFileNames: "assets/js/[name]-[hash].js",
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name || "";
          if (/\.(png|jpe?g|gif|svg|webp|ico)$/i.test(name)) {
            return "assets/images/[name]-[hash][extname]";
          }
          if (/\.css$/i.test(name)) {
            return "assets/css/[name]-[hash][extname]";
          }
          if (/\.(woff2?|eot|ttf|otf)$/i.test(name)) {
            return "assets/fonts/[name]-[hash][extname]";
          }
          return "assets/[name]-[hash][extname]";
        },
      },
    },
    // 设置 chunk 大小警告阈值
    chunkSizeWarningLimit: 500,
    // 启用 CSS 代码分割
    cssCodeSplit: true,
    // 生成 sourcemap 便于调试 (生产可关闭)
    sourcemap: false,
  },
  // 预构建优化
  optimizeDeps: {
    include: [
      "vue",
      "vue-router",
      "pinia",
      "@vueuse/core",
      "socket.io-client",
      "grid-layout-plus",
      "vue-draggable-plus",
    ],
  },
  // ✨✨✨ 关键修改：增加了 /music 的代理 ✨✨✨
  server: {
    host: "0.0.0.0",
    watch: {
      ignored: ["**/data/**", "**/server/**"],
    },
    proxy: {
      // 告诉 Vite：遇到 /api 开头的请求，转给 3000 端口
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      // ✨ 新增：告诉 Vite：遇到 /music 开头的请求，也转给 3000 端口！
      "/music": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      // ✨ Backgrounds 代理
      "/backgrounds": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      "/mobile_backgrounds": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      "/icon-cache": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      // ✨ CGI 代理
      "^.*\\.cgi.*": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      // ✨ Socket.IO 代理
      "/socket.io": {
        target: "http://127.0.0.1:3000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
}));
