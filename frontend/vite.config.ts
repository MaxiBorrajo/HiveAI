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
  },
  ssr: {
    // Externalizamos las librerías del backend para que Vite no intente procesarlas (se resuelven por Deno)
    external: ["../backend/mod.ts", "@langchain/langgraph", "@langchain/core"],
  },
});
