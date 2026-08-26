import { HiveMicrokernel } from "./microkernel/hive-microkernel.ts";
import { join } from "node:path";

// 1. Configuramos el Backend
HiveMicrokernel.getInstance().configure({
  dataDir: join(Deno.env.get("HOME")!, ".hiveai"),
  model: "qwen3:8b",
});

Deno.serve(() => {
  return new Response("Bienvenido a HiveAI", {
    headers: {
      "content-type": "text/plain",
      "Access-Control-Allow-Origin": "*", // Para permitir peticiones de Vite en desarrollo
    },
  });
});
