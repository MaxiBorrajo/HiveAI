import { MODEL } from "./constants.ts";
import { harness } from "./harness.ts";
import type { RoutingQuery } from "./queries.ts";
import { parseArgs } from "@std/cli/parse-args";
import { join } from "@std/path";

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
  {
    id: "q02",
    query:
      "a ver si encontrás algún index.js perdido en la carpeta src/components",
    category: "DIRECTA",
    expected_plugin: "file_search",
    expected_params: {
      pattern: "index.js",
      root: "src/components",
    },
    note: "Pide explícitamente buscar un nombre de archivo en un directorio puntual.",
  },
  {
    id: "q16",
    query: "pasame lo que dice el archivo docker-compose.yml",
    category: "DIRECTA",
    expected_plugin: "file_read",
    expected_params: {
      path: "docker-compose.yml",
      encoding: "utf8",
    },
    note: "Nombra el archivo exacto y pide su contenido. Sin ambigüedad sobre el path ni sobre la herramienta.",
  },
  {
    id: "s01",
    query:
      "decime si te parece que conviene migrar este proyecto de npm a pnpm",
    category: "SIN_MATCH",
    expected_plugin: null,
    expected_params: {},
    note: "Pide un juicio técnico, no una acción. Ningún comando de shell produce una recomendación.",
  },
  {
    id: "s02",
    query: "avisale al equipo que ya subí los cambios",
    category: "SIN_MATCH",
    expected_plugin: null,
    expected_params: {},
    note: "Requiere enviar un mensaje por un canal externo. No hay plugin de mensajería y shell no tiene acceso a Slack ni al mail del equipo.",
  },
  {
    id: "s03",
    query: "fijate cuál es la última versión estable de Deno",
    category: "SIN_MATCH",
    expected_plugin: null,
    expected_params: {},
    note: "La información vive en internet, no en la máquina local. No hay plugin de búsqueda web ni de fetch.",
  },
  {
    id: "p01",
    query: "mostrame qué dependencias tiene este proyecto",
    category: "PARAMS_IMPLICITOS",
    expected_plugin: "file_read",
    expected_params: {
      path: "package.json",
      encoding: "utf8",
    },
    note: "El path no está en el pedido. La única inferencia razonable para 'dependencias de un proyecto' en este contexto es package.json en la raíz.",
  },
  {
    id: "p02",
    query: "buscame todos los tests que haya dando vueltas por acá",
    category: "PARAMS_IMPLICITOS",
    expected_plugin: "file_search",
    expected_params: {
      pattern: "*.test.ts",
      root: ".",
    },
    note: "El patrón no está explícito; hay que inferir la convención de nombre de archivos de test. 'por acá' determina el root.",
  },
  {
    id: "p03",
    query: "quiero ver qué reglas de lint tenemos configuradas",
    category: "PARAMS_IMPLICITOS",
    expected_plugin: "file_read",
    expected_params: {
      path: ".eslintrc.json",
      encoding: "utf8",
    },
    note: "El path se infiere del archivo de configuración del linter del proyecto.",
  },
  {
    id: "a01",
    query: "tirame el contenido del .gitignore",
    category: "AMBIGUA",
    expected_plugin: "file_read",
    expected_params: {
      path: ".gitignore",
      encoding: "utf8",
    },
    note: "shell_exec podría resolverlo con 'cat .gitignore', pero existe un plugin específico para leer archivos y su descripción indica que shell_exec es para tareas sin plugin dedicado.",
  },
  {
    id: "a02",
    query: "listame los archivos .ts que hay en src",
    category: "AMBIGUA",
    expected_plugin: "file_search",
    expected_params: {
      pattern: "*.ts",
      root: "src",
    },
    note: "shell_exec podría hacerlo con 'ls src/*.ts' o 'find', pero file_search es el plugin dedicado a búsqueda de archivos por patrón.",
  },
  {
    id: "a03",
    query: "corré los tests del proyecto",
    category: "AMBIGUA",
    expected_plugin: "shell_exec",
    expected_params: {
      command: "deno test",
      cwd: ".",
    },
    note: "No hay plugin de ejecución de tests, así que corresponde shell_exec como herramienta genérica. Podría tentar a file_search para localizar los tests primero, pero el pedido es ejecutarlos, no encontrarlos.",
  },
];

const RESULTS_DIR = join(import.meta.dirname!, "results");
const runId = `${new Date().toISOString().slice(0, 10)}-${MODEL.replace(":", "-")}`;
const outputPath = join(RESULTS_DIR, `${runId}.jsonl`);

await Deno.mkdir(RESULTS_DIR, { recursive: true });

for (const query of queriesToTry) {
  const verdicts = await harness(
    query,
    Number(catalog),
    strategy as "tool-calling" | "pipeline",
    Number(runs),
  );

  if (!verdicts) continue;

  const lines = verdicts.map((v) => JSON.stringify(v)).join("\n") + "\n";
  await Deno.writeTextFile(outputPath, lines, { append: true });
}

console.log(`Escrito en ${outputPath}`);