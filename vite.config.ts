import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";

// https://vite.dev/config/
export default defineConfig({
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
  server: {
    host: "0.0.0.0",
    port: 1420,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 1420,
    strictPort: true,
  },
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows"
      ? ["chrome105", "edge105"]
      : "es2020",
    sourcemap: 'hidden',
    // 拆包：React 运行时、Live2D framework、ag-psd 各自独立，
    // 页面本身已经是动态 import（见 App.tsx），这里只处理第三方/大型模块。
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules")) {
            if (id.includes("ag-psd")) return "vendor-psd";
            if (id.includes("react-router")) return "vendor-router";
            if (id.includes("react-dom") || id.includes("/react/") || id.includes("scheduler")) {
              return "vendor-react";
            }
            if (id.includes("live2d")) return "vendor-live2d";
            return undefined;
          }
          if (id.includes("/src/live2d/")) return "live2d-framework";
          return undefined;
        },
      },
    },
  },
  plugins: [
    react({
      babel: {
        plugins: [
          'react-dev-locator',
        ],
      },
    }),
    tsconfigPaths()
  ],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
  },
})
