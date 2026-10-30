import { defineConfig, type UserConfig } from "vite";
import type { InlineConfig as VitestInlineConfig } from "vitest/node";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// `test` isn't part of Vite's own UserConfig type — it's injected by
// vitest/config's defineConfig, but that one bundles its own (older) copy
// of Vite's types which conflicts with this project's Vite version here.
// Declaring it as its own type and intersecting below gets Vitest's config
// type-checked without pulling in that conflicting defineConfig.
type ViteConfigWithTest = UserConfig & { test?: VitestInlineConfig };

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
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
    css: false,
    coverage: {
      exclude: [
        "./src/main.tsx",
        "**/*.cjs",
        "**/*.d.ts",
        "vite.config.ts",
        "**/*.config.*",
      ],
      reporter: ["lcov", "json", "html", "json-summary", "text"],
    },
  },
} satisfies ViteConfigWithTest as UserConfig);
