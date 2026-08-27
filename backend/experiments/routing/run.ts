import { harness } from "./harness.ts";
import type { RoutingQuery } from "./queries.ts";
import { parseArgs } from "@std/cli/parse-args";

const { strategy, catalog, runs } = parseArgs(Deno.args, {
  string: ["strategy", "catalog", "runs"],
});

if (!strategy || !catalog || !runs) {
  console.error("Faltan parametros");
  Deno.exit(1);
}

const queriesToTry: RoutingQuery[] = [
  {
    id: "q01",
    query: "¿dónde metí los archivitos de migración que terminan en .sql?",
    category: "DIRECTA",
    expected_plugin: "file_search",
    expected_params: {
      pattern: "*.sql",
      root: ".",
    },
    note: "El usuario busca archivos con un sufijo específico, tarea exacta de búsqueda por nombre.",
  },
//   {
//     id: "q02",
//     query:
//       "a ver si encontrás algún index.js perdido en la carpeta src/components",
//     category: "DIRECTA",
//     expected_plugin: "file_search",
//     expected_params: {
//       pattern: "index.js",
//       root: "src/components",
//     },
//     note: "Pide explícitamente buscar un nombre de archivo en un directorio puntual.",
//   },
//   {
//     id: "q16",
//     query:
//       "me olvidé donde escucha la base de datos en el compose, me decis cual es?",
//     category: "AMBIGUA",
//     expected_plugin: "file_read",
//     expected_params: {
//       path: "docker-compose.yml",
//       encoding: "utf8",
//     },
//     note: "Podría tentar al modelo a usar json_read si asume estructuras genéricas, pero al ser formato YAML, debe leer el documento completo.",
//   },
//   {
//     id: "q21",
//     query:
//       "necesitamos reemplazar todas las comillas dobles por simples en el index.js",
//     category: "SIN_MATCH",
//     expected_plugin: null,
//     expected_params: {},
//     note: "El catálogo no cuenta con una herramienta de reemplazo de texto o refactorización masiva de código.",
//   },
//   {
//     id: "q28",
//     query: "ni idea dónde andan los estilos en este quilombo",
//     category: "PARAMS_IMPLICITOS",
//     expected_plugin: "file_search",
//     expected_params: {
//       pattern: "*.css",
//       root: ".",
//     },
//     note: "El sufijo de archivo no está en el prompt; el modelo debe inferir que 'estilos' requiere buscar patrones como '*.css'.",
//   },
];

for (const query of queriesToTry) {
  const result = await harness(
    query,
    Number(catalog),
    strategy as "tool-calling" | "pipeline",
    Number(runs),
  );

  console.log(JSON.stringify(result));
}
