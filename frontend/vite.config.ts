import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
    // @monaco-editor/react was resolving its own copy of react/react-dom
    // instead of the app's, causing "Invalid hook call" — Monaco's own
    // useState call was hitting a different React instance than the one
    // that rendered the tree. Forcing dedupe makes every import of these
    // (regardless of which package requested them) resolve to the exact
    // same module instance.
    dedupe: ["react", "react-dom"],
  },
  ssr: {
    external: ["../backend/mod.ts", "@langchain/langgraph", "@langchain/core"],
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
