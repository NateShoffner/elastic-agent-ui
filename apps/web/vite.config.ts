import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev, the bridge runs with --dev (scripts/dev-mock.ts sets EAUI_BRIDGE to its port); Vite proxies the API and the /auth link to it,
// so the session cookie is set for the Vite origin.
const bridge = process.env.EAUI_BRIDGE ?? "http://127.0.0.1:7700";

export default defineConfig({
  plugins: [react()],
  // EUI is large (~2 MB minified); fine for an app served from localhost.
  build: { chunkSizeWarningLimit: 4096 },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: bridge, changeOrigin: true },
      "/auth": { target: bridge, changeOrigin: true },
    },
  },
});
