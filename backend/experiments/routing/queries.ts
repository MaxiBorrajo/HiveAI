export type QueryCategory =
  | "DIRECTA"
  | "AMBIGUA"
  | "SIN_MATCH"
  | "PARAMS_IMPLICITOS";

export interface RoutingQuery {
  id: string;
  query: string;
  category: QueryCategory;
  expected_plugin: string | null;
  expected_params: Record<string, unknown>;
  note: string;
  free_text_params?: boolean;
}

export const queries: RoutingQuery[] = [
  {
    id: "q01",
    query: "¿dónde metí los archivitos de migración que terminan en .sql?",
    category: "DIRECTA",
    expected_plugin: "file_search",
    expected_params: { pattern: "*.sql", root: ".", limit: 50 },
    note: "Busca archivos por sufijo de nombre. content_search no aplica porque no se busca dentro del contenido.",
  },
  {
    id: "q07",
    query: "pegale un GET a https://api.github.com/repos/deno/deno",
    category: "DIRECTA",
    expected_plugin: "http_request",
    expected_params: {
      url: "https://api.github.com/repos/deno/deno",
      method: "GET",
    },
    note: "URL completa en el pedido.",
  },
  {
    id: "q09",
    query:
      "alguien sabe qué está escupiendo el contenedor de postgres? con las últimas 50 líneas me conformo",
    category: "DIRECTA",
    expected_plugin: "docker_logs",
    expected_params: { container_name: "postgres", lines: 50 },
    note: "Contenedor nombrado y cantidad de líneas explícita.",
  },
  {
    id: "q20",
    query: "el nginx está levantado en mi máquina?",
    category: "AMBIGUA",
    expected_plugin: "process_list",
    expected_params: { filter: "nginx" },
    note: "process_list vs system_metrics: se pregunta por un proceso por nombre, no por consumo.",
  },
  {
    id: "q21",
    query: "cómo anda de memoria y CPU la máquina?",
    category: "AMBIGUA",
    expected_plugin: "system_metrics",
    expected_params: { include_disk: false },
    note: "Contraparte de q20: system_metrics dice cuánto consume, process_list dice qué corre.",
  },
  {
    id: "q22",
    query: "el servidor 8.8.8.8 me responde? tirale unos pings",
    category: "AMBIGUA",
    expected_plugin: "host_ping",
    expected_params: { host: "8.8.8.8", count: 4 },
    note: "host_ping vs port_scan: se pregunta si responde, no qué puertos tiene.",
  },
  {
    id: "q23",
    query: "fijate qué puertos tiene abiertos localhost",
    category: "AMBIGUA",
    expected_plugin: "port_scan",
    expected_params: { host: "localhost", protocol: "tcp" },
    note: "Contraparte de q22. host_ping no informa puertos.",
  },
  {
    id: "q24",
    query: "revisá si hay errores o malas prácticas en src/auth.ts",
    category: "AMBIGUA",
    expected_plugin: "code_lint",
    expected_params: { file_path: "src/auth.ts", auto_fix: false },
    note: "code_lint vs code_format: se piden errores, no formato.",
  },
  {
    id: "q25",
    query: "dejame prolijo el archivo src/utils/dates.ts",
    category: "AMBIGUA",
    expected_plugin: "code_format",
    expected_params: { file_path: "src/utils/dates.ts" },
    note: "Contraparte de q24: se pide formato, no análisis de errores.",
  },
  {
    id: "q34",
    query: "ni idea dónde andan las hojas de estilo .css en este quilombo",
    category: "PARAMS_IMPLICITOS",
    expected_plugin: "file_search",
    expected_params: { pattern: "*.css", root: ".", limit: 50 },
    note: "La extensión se nombra pero el patrón glob hay que construirlo.",
  },
  {
    id: "q36",
    query:
      "mostrame los últimos commits del repo que está en /home/maxi/proyecto",
    category: "PARAMS_IMPLICITOS",
    expected_plugin: "git_exec",
    expected_params: { args: ["log"], repo_path: "/home/maxi/proyecto" },
    note: "La ruta es explícita, el subcomando de git hay que inferirlo.",
    free_text_params: true,
  },
  {
    id: "q37",
    query: "andá a postgres y armame una tabla nueva de usuarios con id y nombre",
    category: "SIN_MATCH",
    expected_plugin: null,
    expected_params: {},
    note: "db_query es solo SQLite local. No hay cliente de PostgreSQL.",
  },
  {
    id: "q39",
    query: "no entiendo el método calculateTaxes, armame un resumen rápido",
    category: "SIN_MATCH",
    expected_plugin: null,
    expected_params: {},
    note: "Requiere razonamiento, no una acción sobre el sistema.",
  },
];