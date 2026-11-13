import { realpathSync } from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, "../..", "VITE_"),
    ...loadEnv(mode, process.cwd(), "VITE_"),
    ...process.env,
  };
  return {
    plugins: [react()],
    css: { postcss: { plugins: [] } },
    base: "./",
    server: {
      port: 3002,
      strictPort: true,
      proxy: {
        "/api": {
          target: env.VITE_CODING_BRO_API_URL || "http://127.0.0.1:3001",
          changeOrigin: true,
          configure(proxy) {
            proxy.on("proxyReq", (request) => request.removeHeader("origin"));
          },
        },
      },
    },
    build: { outDir: path.join(realpathSync(__dirname), "dist"), emptyOutDir: true },
    clearScreen: false,
    envPrefix: ["VITE_", "TAURI_"],
    define: {
      "import.meta.env.VITE_CODING_BRO_API_URL": JSON.stringify(
        env.VITE_CODING_BRO_API_URL || "",
      ),
    },
  };
});
