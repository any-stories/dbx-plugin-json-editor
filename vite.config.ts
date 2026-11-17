import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 构建产物输出到 ui/, 与 manifest.json 的 entrypoints.ui.root 保持一致
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "ui",
    emptyOutDir: true,
    target: "es2020",
    // 插件运行在 Chromium 内核宿主中: CSS 不做旧浏览器前缀降级, 否则 lightningcss 会把
    // backdrop-filter 合并成只剩 -webkit- 前缀的写法, 导致玻璃模糊在 Chrome 里失效
    cssTarget: "chrome110"
  }
});
