import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueDevTools from "vite-plugin-vue-devtools";

// https://vite.dev/config/
  export default defineConfig(({ mode }) => ({
    plugins: [vue(), mode === "development" && vueDevTools()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
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
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      // ✨ 新增：告诉 Vite：遇到 /music 开头的请求，也转给 3000 端口！
      "/music": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      // ✨ Backgrounds 代理
      "/backgrounds": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/mobile_backgrounds": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      // ✨ CGI 代理
      "^.*\\.cgi.*": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      // ✨ Socket.IO 代理
      "/socket.io": {
        target: "http://localhost:3000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
}));
