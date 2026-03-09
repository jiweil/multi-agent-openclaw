import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  build: { outDir: "../dist/ui", emptyOutDir: true },
  server: {
    port: 5174,
    proxy: {
      "/api": "http://localhost:3100",
      "/ws": { target: "ws://localhost:3100", ws: true },
    },
  },
});
