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
  expected_params: Record<string, any>;
  note: string;
}

export const queries: RoutingQuery[] = [
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
    id: "q03",
    query:
      "necesito que tires un npm install rápido a ver si se arreglan las dependencias",
    category: "DIRECTA",
    expected_plugin: "shell_exec",
    expected_params: {
      command: "npm install",
      cwd: ".",
      timeout_ms: 30000,
    },
    note: "Solicita correr un comando genérico de terminal en el sistema.",
  },
  {
    id: "q04",
    query: "borrá la carpeta node_modules entera de una vez por todas",
    category: "DIRECTA",
    expected_plugin: "shell_exec",
    expected_params: {
      command: "rm -rf node_modules",
      cwd: ".",
      timeout_ms: 30000,
    },
    note: "Pide una operación del sistema operativo (borrar un directorio) que se logra ejecutando comandos.",
  },
  {
    id: "q05",
    query: "quiero ver qué dice el README.md que está en la raíz del proyecto",
    category: "DIRECTA",
    expected_plugin: "file_read",
    expected_params: {
      path: "README.md",
      encoding: "utf8",
    },
    note: "Pide inspeccionar el contenido completo de un documento específico.",
  },
  {
    id: "q06",
    query: "pasame todo lo que haya adentro del config.yml de prod",
    category: "DIRECTA",
    expected_plugin: "file_read",
    expected_params: {
      path: "config.yml",
      encoding: "utf8",
    },
    note: "Exige recuperar el texto de un documento de configuración de forma literal.",
  },
  {
    id: "q07",
    query:
      "hacele un llamado a la api de usuarios en localhost a ver qué nos devuelve",
    category: "DIRECTA",
    expected_plugin: "http_request",
    expected_params: {
      url: "http://localhost/api/usuarios",
      method: "GET",
    },
    note: "Se pide contactar una API externa a nivel de red para obtener una respuesta.",
  },
  {
    id: "q08",
    query:
      "arrancá el entorno local en el 8080 y dejale el hot reload prendido",
    category: "DIRECTA",
    expected_plugin: "dev_server",
    expected_params: {
      port: 8080,
      hot_reload: true,
    },
    note: "Es un pedido directo a la herramienta diseñada para iniciar un entorno de desarrollo local.",
  },
  {
    id: "q09",
    query:
      "alguien sabe qué está escupiendo el contenedor de postgres? con las últimas 50 líneas me conformo",
    category: "DIRECTA",
    expected_plugin: "docker_logs",
    expected_params: {
      container_name: "postgres",
      lines: 50,
    },
    note: "Menciona un contenedor puntual y pide el registro de salida, un mapeo directo.",
  },
  {
    id: "q10",
    query: "ese bicho 4052 me dejó colgada la máquina, aniquilalo ya mismo",
    category: "DIRECTA",
    expected_plugin: "process_kill",
    expected_params: {
      pid: 4052,
      force: true,
    },
    note: "Ordena terminar de forma forzosa un elemento del sistema operativo por su identificador.",
  },
  {
    id: "q11",
    query:
      "reportá un ticket avisando que se rompe el login en mobile, y acordate de meterle la etiqueta de error",
    category: "DIRECTA",
    expected_plugin: "github_issue",
    expected_params: {
      title: "Se rompe el login en mobile",
      body: "El login está fallando en la versión móvil de la aplicación.",
      labels: ["error"],
    },
    note: "Tarea explícita de seguimiento de tareas utilizando un sistema de tickets.",
  },
  {
    id: "q12",
    query:
      "pasale el verificador a todo lo que tenga auth en el título, sin actualizar las capturas visuales",
    category: "DIRECTA",
    expected_plugin: "unit_test",
    expected_params: {
      filter: "auth",
      update_snapshots: false,
    },
    note: "Pide ejecutar suites de verificación ignorando la actualización de recursos visuales.",
  },
  {
    id: "q13",
    query:
      "sobre el cambio que acabo de commitear, lo mandamos al remoto o esperamos?",
    category: "AMBIGUA",
    expected_plugin: "git_exec",
    expected_params: {
      args: ["push"],
      repo_path: ".",
    },
    note: "Podría resolverse con shell_exec ('git push'), pero al existir un plugin especializado para control de versiones, este es el idóneo.",
  },
  {
    id: "q14",
    query:
      "estoy seguro que dejamos un TODO sobre arreglar la validación de email, rastrealo en la lógica",
    category: "AMBIGUA",
    expected_plugin: "content_search",
    expected_params: {
      query: "TODO",
      is_regex: false,
      directory: ".",
    },
    note: "Se confunde fácilmente con búsqueda por nombre, pero el usuario busca una cadena de texto (TODO) dentro del código fuente.",
  },
  {
    id: "q15",
    query:
      "tengo que probar la herramienta de scraping que armamos en src/scraper.py, ponela a andar",
    category: "AMBIGUA",
    expected_plugin: "python_exec",
    expected_params: {
      script_path: "src/scraper.py",
      args: [],
    },
    note: "Aunque shell_exec puede hacerlo, existe un intérprete especializado para este lenguaje específico que es más seguro invocar.",
  },
  {
    id: "q16",
    query:
      "me olvidé donde escucha la base de datos en el compose, me decis cual es?",
    category: "AMBIGUA",
    expected_plugin: "file_read",
    expected_params: {
      path: "docker-compose.yml",
      encoding: "utf8",
    },
    note: "Podría tentar al modelo a usar json_read si asume estructuras genéricas, pero al ser formato YAML, debe leer el documento completo.",
  },
  {
    id: "q17",
    query: "qué hay adentro de la carpeta utils?",
    category: "AMBIGUA",
    expected_plugin: "directory_list",
    expected_params: {
      path: "utils",
      show_hidden: false,
    },
    note: "Se solapa con una búsqueda de archivos sin patrón (file_search), pero la intención es simplemente visualizar el primer nivel del directorio.",
  },
  {
    id: "q18",
    query: "cuánto pesa el dump volcado.sql",
    category: "AMBIGUA",
    expected_plugin: "file_metadata",
    expected_params: {
      path: "volcado.sql",
    },
    note: "Leer todo el texto con file_read para ver el peso es ineficiente; se debe consultar a nivel de metadatos del sistema de archivos.",
  },
  {
    id: "q19",
    query: "extraé la  api_key del documento de dependencias de node, porfa",
    category: "AMBIGUA",
    expected_plugin: "json_read",
    expected_params: {
      path: "package.json",
      json_path: "api_key",
    },
    note: "En lugar de descargar el paquete entero (file_read), usar la utilidad que extrae la clave puntual ahorra contexto.",
  },
  {
    id: "q20",
    query: "el nginx está levantado en mi máquina?",
    category: "AMBIGUA",
    expected_plugin: "process_list",
    expected_params: {
      filter: "nginx",
    },
    note: "Se podría intentar buscar su puerto habitual (port_scan), pero la consulta apunta directamente al nombre del programa en ejecución.",
  },
  {
    id: "q21",
    query:
      "necesitamos reemplazar todas las comillas dobles por simples en el index.js",
    category: "SIN_MATCH",
    expected_plugin: null,
    expected_params: {},
    note: "El catálogo no cuenta con una herramienta de reemplazo de texto o refactorización masiva de código.",
  },
  {
    id: "q22",
    query:
      "andá a postgres y armame una tabla nueva de usuarios con id y nombre",
    category: "SIN_MATCH",
    expected_plugin: null,
    expected_params: {},
    note: "El usuario pide DDL en PostgreSQL, y el único conector de bases de datos es exclusivo para entornos locales SQLite.",
  },
  {
    id: "q23",
    query:
      "el pase a prod ya está listo, mandale un mail al cliente para avisar",
    category: "SIN_MATCH",
    expected_plugin: null,
    expected_params: {},
    note: "No existe un conector para enviar correos electrónicos de forma nativa (solo mensajería vía Slack).",
  },
  {
    id: "q24",
    query: "no entiendo el método calculateTaxes, armame un resumen rápido",
    category: "SIN_MATCH",
    expected_plugin: null,
    expected_params: {},
    note: "Ninguna herramienta del catálogo tiene capacidades de resumir, explicar lógica de programación o utilizar LLMs.",
  },
  {
    id: "q25",
    query:
      "necesito visualizar cómo está quedando la landing page en el navegador",
    category: "SIN_MATCH",
    expected_plugin: null,
    expected_params: {},
    note: "El agente no dispone de integraciones para automatizar, controlar de forma visual o tomar capturas de un navegador web.",
  },
  {
    id: "q26",
    query: "transformá la constante de configuración entera a mayúsculas",
    category: "SIN_MATCH",
    expected_plugin: null,
    expected_params: {},
    note: "No se incluyen herramientas genéricas para manipular o alterar formatos de cadenas de texto (solo existe hash o traducción).",
  },
  {
    id: "q27",
    query:
      "ya fue, llevate el proyecto a aws con la configuración que tenemos hoy",
    category: "SIN_MATCH",
    expected_plugin: null,
    expected_params: {},
    note: "El catálogo de utilidades carece de integraciones con proveedores cloud o pipelines de despliegue automático de infraestructura.",
  },
  {
    id: "q28",
    query: "ni idea dónde andan los estilos en este quilombo",
    category: "PARAMS_IMPLICITOS",
    expected_plugin: "file_search",
    expected_params: {
      pattern: "*.css",
      root: ".",
    },
    note: "El sufijo de archivo no está en el prompt; el modelo debe inferir que 'estilos' requiere buscar patrones como '*.css'.",
  },
  {
    id: "q29",
    query:
      "vino este texto raro 'id;nombre\\n1;juan', pasalo a un formato de objetos para procesarlo",
    category: "PARAMS_IMPLICITOS",
    expected_plugin: "csv_to_json",
    expected_params: {
      csv: "id;nombre\n1;juan",
      delimiter: ";",
    },
    note: "El carácter delimitador no se provee como instrucción directa, debe ser inferido analizando la estructura semántica de la cadena.",
  },
  {
    id: "q30",
    query: "traducime la frase 'good morning' a nuestro idioma",
    category: "PARAMS_IMPLICITOS",
    expected_plugin: "text_translate",
    expected_params: {
      text: "good morning",
      target_lang: "es",
      source_lang: "en",
    },
    note: "Omite los identificadores de idioma; el sistema debe deducir que 'nuestro idioma' es español ('es') según la charla.",
  },
  {
    id: "q31",
    query:
      "armame la firma criptográfica más robusta y segura que encuentres para 'secreto123'",
    category: "PARAMS_IMPLICITOS",
    expected_plugin: "string_hash",
    expected_params: {
      text: "secreto123",
      algorithm: "sha256",
    },
    note: "El algoritmo exacto no se menciona; se pide el 'más robusto', forzando a elegir opciones fuertes como sha256 sobre otras más débiles.",
  },
  {
    id: "q32",
    query:
      "consultá el almacén local.data y devolveme todos los usuarios que haya",
    category: "PARAMS_IMPLICITOS",
    expected_plugin: "db_query",
    expected_params: {
      db_path: "local.data",
      query: "SELECT * FROM usuarios;",
    },
    note: "La consulta de extracción técnica no existe en la frase, por lo que el modelo está forzado a construir el 'SELECT *' en base a la necesidad.",
  },
];
