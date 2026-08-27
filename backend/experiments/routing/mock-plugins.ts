import { z } from "zod";

export interface MockPlugin {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
}

export const MOCK_PLUGINS: MockPlugin[] = [
  {
    name: "file_search",
    description:
      "Busca archivos en el sistema de archivos local cuyo nombre coincida con un patrón glob. Devuelve rutas. No busca dentro del contenido de los archivos ni lista un directorio completo.",
    schema: z.object({
      pattern: z
        .string()
        .describe("Patrón glob del nombre a buscar, por ejemplo *.ts"),
      root: z
        .string()
        .default(".")
        .describe("Directorio raíz desde donde iniciar la búsqueda"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .default(50)
        .describe("Cantidad máxima de resultados a devolver"),
    }),
  },
  {
    name: "shell_exec",
    description:
      "Ejecuta un comando de shell arbitrario en el sistema operativo local. Cubre tareas de sistema sin plugin propio, como mover archivos, cambiar permisos o comprimir carpetas.",
    schema: z.object({
      command: z
        .string()
        .describe("Comando exacto a ejecutar, por ejemplo 'chmod +x deploy.sh'"),
      cwd: z
        .string()
        .default(".")
        .describe("Directorio de trabajo donde se ejecutará el comando"),
      timeout_ms: z
        .number()
        .int()
        .min(1000)
        .default(30000)
        .describe("Tiempo límite en milisegundos para abortar el proceso"),
    }),
  },
  {
    name: "file_read",
    description:
      "Lee y devuelve el contenido completo de texto de un archivo local. Requiere la ruta exacta: no busca archivos ni lista directorios.",
    schema: z.object({
      path: z
        .string()
        .describe("Ruta absoluta o relativa del archivo a leer"),
      encoding: z
        .enum(["utf8", "ascii", "base64"])
        .default("utf8")
        .describe("Codificación de caracteres esperada"),
    }),
  },
  {
    name: "content_search",
    description:
      "Busca un texto o expresión regular dentro del contenido de los archivos de un directorio. No sirve para encontrar archivos por su nombre.",
    schema: z.object({
      query: z
        .string()
        .describe("Texto exacto o expresión regular a buscar dentro de los archivos"),
      is_regex: z
        .boolean()
        .default(false)
        .describe("Si es true, interpreta la query como expresión regular"),
      directory: z
        .string()
        .default(".")
        .describe("Directorio base desde donde buscar en profundidad"),
    }),
  },
  {
    name: "git_exec",
    description:
      "Ejecuta comandos de git sobre el repositorio local: commits, ramas, historial, estado. Es el plugin indicado para cualquier operación de git.",
    schema: z.object({
      args: z
        .array(z.string())
        .describe("Argumentos del comando git, por ejemplo ['commit', '-m', 'Fix']"),
      repo_path: z
        .string()
        .default(".")
        .describe("Ruta al directorio que contiene el repositorio .git"),
    }),
  },
  {
    name: "file_metadata",
    description:
      "Devuelve los metadatos de un archivo: tamaño, fecha de modificación y permisos. No devuelve el contenido del archivo.",
    schema: z.object({
      path: z
        .string()
        .describe("Ruta del archivo del cual obtener metadatos"),
    }),
  },
  {
    name: "python_exec",
    description:
      "Ejecuta un archivo .py con el entorno Python del proyecto, de manera aislada. Es el plugin indicado para correr scripts de Python.",
    schema: z.object({
      script_path: z
        .string()
        .describe("Ruta al archivo Python a ejecutar"),
      args: z
        .array(z.string())
        .default([])
        .describe("Lista de argumentos posicionales para el script"),
    }),
  },
  {
    name: "directory_list",
    description:
      "Lista el contenido inmediato de un directorio: archivos y subcarpetas de ese nivel. No baja recursivamente ni filtra por patrón.",
    schema: z.object({
      path: z
        .string()
        .describe("Ruta del directorio a listar"),
      show_hidden: z
        .boolean()
        .default(false)
        .describe("Incluir archivos y carpetas ocultos que comienzan con punto"),
    }),
  },
  {
    name: "json_read",
    description:
      "Extrae un valor puntual de un archivo JSON indicando la ruta de la propiedad. Evita cargar el archivo entero cuando solo se necesita un dato.",
    schema: z.object({
      path: z
        .string()
        .describe("Ruta al archivo JSON local"),
      json_path: z
        .string()
        .describe("Ruta de la propiedad a extraer, por ejemplo 'dependencies.zod'"),
    }),
  },
  {
    name: "system_metrics",
    description:
      "Devuelve el consumo actual de CPU, memoria y disco de la máquina local. No informa qué procesos están corriendo.",
    schema: z.object({
      include_disk: z
        .boolean()
        .default(false)
        .describe("Incluir métricas de entrada/salida de disco"),
    }),
  },
  {
    name: "http_request",
    description:
      "Hace una petición HTTP a una URL externa y devuelve la respuesta. Sirve para consultar APIs o descargar información remota.",
    schema: z.object({
      url: z
        .string()
        .describe("URL completa incluyendo protocolo, por ejemplo 'https://api.ejemplo.com'"),
      method: z
        .enum(["GET", "POST", "PUT", "DELETE"])
        .default("GET")
        .describe("Verbo HTTP a utilizar"),
    }),
  },
  {
    name: "db_query",
    description:
      "Ejecuta una sentencia SQL sobre una base de datos SQLite local. No se conecta a bases de datos remotas ni a PostgreSQL.",
    schema: z.object({
      query: z
        .string()
        .describe("Consulta SQL completa a ejecutar"),
      db_path: z
        .string()
        .describe("Ruta al archivo local de la base SQLite (.db o .sqlite)"),
    }),
  },
  {
    name: "dev_server",
    description:
      "Levanta el servidor de desarrollo del proyecto y lo deja corriendo en segundo plano. No compila para producción.",
    schema: z.object({
      port: z
        .number()
        .int()
        .min(1024)
        .max(65535)
        .default(3000)
        .describe("Puerto TCP donde levantar el servidor"),
      hot_reload: z
        .boolean()
        .default(true)
        .describe("Recargar automáticamente al detectar cambios en archivos"),
    }),
  },
  {
    name: "unit_test",
    description:
      "Corre la suite de tests del proyecto y devuelve el resultado. Permite filtrar qué casos ejecutar por nombre.",
    schema: z.object({
      filter: z
        .string()
        .optional()
        .describe("Texto o patrón para filtrar los casos de prueba a ejecutar"),
      update_snapshots: z
        .boolean()
        .default(false)
        .describe("Actualizar los snapshots de las pruebas que fallen"),
    }),
  },
  {
    name: "github_issue",
    description:
      "Crea un issue nuevo en el repositorio de GitHub del proyecto. Sirve para reportar bugs o registrar tareas pendientes.",
    schema: z.object({
      title: z
        .string()
        .describe("Título corto y descriptivo del issue"),
      body: z
        .string()
        .describe("Cuerpo detallado del issue en formato Markdown"),
      labels: z
        .array(z.string())
        .default([])
        .describe("Etiquetas para clasificar el issue, por ejemplo ['bug', 'frontend']"),
    }),
  },
  {
    name: "code_format",
    description:
      "Formatea un archivo de código según las reglas de estilo del proyecto. Solo cambia el formato: no detecta errores ni malas prácticas.",
    schema: z.object({
      file_path: z
        .string()
        .describe("Ruta al archivo de código a formatear"),
    }),
  },
  {
    name: "code_lint",
    description:
      "Analiza un archivo de código con el linter del proyecto y reporta errores y malas prácticas. No reformatea el código por sí solo.",
    schema: z.object({
      file_path: z
        .string()
        .describe("Ruta del archivo a analizar"),
      auto_fix: z
        .boolean()
        .default(false)
        .describe("Aplicar las correcciones automáticas que soporte el linter"),
    }),
  },
  {
    name: "docker_logs",
    description:
      "Devuelve las últimas líneas del log de un contenedor Docker que está corriendo localmente.",
    schema: z.object({
      container_name: z
        .string()
        .describe("Nombre o identificador parcial del contenedor"),
      lines: z
        .number()
        .int()
        .min(1)
        .max(5000)
        .default(100)
        .describe("Cantidad de líneas más recientes a devolver"),
    }),
  },
  {
    name: "process_list",
    description:
      "Lista los procesos que están corriendo en el sistema local. Sirve para verificar si un servicio está activo. No informa consumo de recursos de la máquina.",
    schema: z.object({
      filter: z
        .string()
        .optional()
        .describe("Filtro parcial por nombre del proceso, por ejemplo 'node'"),
    }),
  },
  {
    name: "process_kill",
    description:
      "Termina un proceso del sistema a partir de su PID. Requiere conocer el identificador numérico del proceso.",
    schema: z.object({
      pid: z
        .number()
        .int()
        .describe("Identificador numérico (PID) del proceso a terminar"),
      force: z
        .boolean()
        .default(false)
        .describe("Usar SIGKILL en lugar de SIGTERM para un cierre abrupto"),
    }),
  },
  {
    name: "host_ping",
    description:
      "Envía paquetes ICMP a un host para verificar si responde y medir la latencia. No indica qué puertos tiene abiertos.",
    schema: z.object({
      host: z
        .string()
        .describe("Dirección IP o nombre de dominio a diagnosticar"),
      count: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(4)
        .describe("Cantidad de paquetes ICMP a enviar"),
    }),
  },
  {
    name: "port_scan",
    description:
      "Verifica qué puertos están abiertos y escuchando en una máquina. No comprueba si el host responde a ping ni qué servicio corre detrás.",
    schema: z.object({
      host: z
        .string()
        .default("localhost")
        .describe("Dirección IP o dominio a escanear"),
      protocol: z
        .enum(["tcp", "udp"])
        .default("tcp")
        .describe("Protocolo de transporte a escanear"),
    }),
  },
  {
    name: "csv_to_json",
    description:
      "Convierte un archivo CSV local a formato JSON. Devuelve el resultado como un array de objetos.",
    schema: z.object({
      path: z
        .string()
        .describe("Ruta al archivo CSV a convertir"),
      delimiter: z
        .string()
        .default(",")
        .describe("Carácter que separa las columnas del archivo"),
    }),
  },
  {
    name: "string_hash",
    description:
      "Calcula el hash de un texto con el algoritmo indicado. Es unidireccional: no cifra ni permite recuperar el texto original.",
    schema: z.object({
      text: z
        .string()
        .describe("Texto del cual calcular el hash"),
      algorithm: z
        .enum(["md5", "sha1", "sha256", "sha512"])
        .default("sha256")
        .describe("Algoritmo de hash a aplicar"),
    }),
  },
  {
    name: "calendar_event",
    description:
      "Agenda un evento en el calendario del usuario. No lee ni consulta eventos existentes.",
    schema: z.object({
      title: z
        .string()
        .describe("Título del evento a crear"),
      datetime_iso: z
        .string()
        .describe("Fecha y hora de inicio en formato ISO 8601"),
      duration_mins: z
        .number()
        .int()
        .min(5)
        .default(30)
        .describe("Duración del evento en minutos"),
    }),
  },
  {
    name: "slack_message",
    description:
      "Envía un mensaje a un canal de Slack o a un usuario del equipo. Sirve para avisar de un deploy, un fallo o el avance de una tarea.",
    schema: z.object({
      target: z
        .string()
        .describe("Canal destino, por ejemplo '#general', o nombre del usuario"),
      message: z
        .string()
        .describe("Contenido del mensaje a enviar"),
    }),
  },
  {
    name: "weather_forecast",
    description:
      "Devuelve el clima actual y el pronóstico a corto plazo para una ubicación.",
    schema: z.object({
      location: z
        .string()
        .describe("Nombre de la ciudad o coordenadas separadas por coma"),
      unit: z
        .enum(["celsius", "fahrenheit"])
        .default("celsius")
        .describe("Unidad de temperatura a devolver"),
    }),
  },
  {
    name: "text_translate",
    description:
      "Traduce un texto de un idioma a otro usando un servicio de traducción remoto.",
    schema: z.object({
      text: z
        .string()
        .describe("Texto a traducir"),
      target_lang: z
        .string()
        .describe("Código de dos letras del idioma destino, por ejemplo 'es'"),
      source_lang: z
        .string()
        .optional()
        .describe("Código del idioma original. Si se omite, se autodetecta"),
    }),
  },
  {
    name: "math_eval",
    description:
      "Evalúa una expresión matemática pasada como texto y devuelve el resultado numérico.",
    schema: z.object({
      expression: z
        .string()
        .describe("Expresión a calcular, por ejemplo '2 + (3 * 4) / 10'"),
    }),
  },
  {
    name: "uuid_generate",
    description:
      "Genera identificadores únicos (UUID v4) al azar. Sirve para crear IDs o tokens de prueba.",
    schema: z.object({
      uppercase: z
        .boolean()
        .default(false)
        .describe("Devolver el UUID en mayúsculas"),
      count: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(1)
        .describe("Cantidad de UUIDs a generar"),
    }),
  },
];