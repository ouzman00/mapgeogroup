import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const devApiTarget = process.env.VITE_DEV_API_TARGET || "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: devApiTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("leaflet") || id.includes("@geoman-io")) return "vendor-map";
          if (id.includes("jspdf") || id.includes("html2canvas") || id.includes("canvg")) return "vendor-export";
          return "vendor";
        },
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/setupTests.js",
    globals: true,
  },
});
