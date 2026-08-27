
import { z } from "zod";

export interface MockPlugin {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
}

export const MOCK_PLUGINS: MockPlugin[] = [
  {
    name: "file_search",
    description: "Busca archivos en el sistema de archivos local cuyo nombre coincida con un patrón glob. Devuelve rutas absolutas. No busca dentro del contenido de los archivos.",
    schema: z.object({
      pattern: z.string().describe("Patrón glob del nombre a buscar, por ejemplo *.ts"),
      root: z.string().default(".").describe("Directorio raíz desde donde iniciar la búsqueda"),
      limit: z.number().int().min(1).max(200).default(50).describe("Cantidad máxima de resultados a devolver")
    })
  },
  {
    name: "shell_exec",
    description: "Ejecuta un comando de shell arbitrario en el sistema operativo local. Ideal para tareas genéricas que no tengan un plugin específico.",
    schema: z.object({
      command: z.string().describe("Comando exacto a ejecutar, por ejemplo 'npm install'"),
      cwd: z.string().default(".").describe("Directorio de trabajo donde se ejecutará el comando"),
      timeout_ms: z.number().int().min(1000).default(30000).describe("Tiempo límite en milisegundos para abortar el proceso")
    })
  },
  {
    name: "file_read",
    description: "Lee todo el contenido de texto de un archivo local. No usar para leer metadatos, estructurar partes de JSON, ni listar directorios.",
    schema: z.object({
      path: z.string().describe("Ruta absoluta o relativa del archivo a leer"),
      encoding: z.enum(["utf8", "ascii", "base64"]).default("utf8").describe("Codificación de caracteres esperada")
    })
  },
  {
    name: "content_search",
    description: "Busca texto o expresiones regulares dentro del contenido de los archivos de un directorio. No debe usarse para encontrar archivos solo por su nombre.",
    schema: z.object({
      query: z.string().describe("Texto exacto o expresión regular a buscar dentro de los archivos"),
      is_regex: z.boolean().default(false).describe("Si es true, interpreta la query como expresión regular"),
      directory: z.string().default(".").describe("Directorio base para iniciar la búsqueda en profundidad")
    })
  },
  {
    name: "git_exec",
    description: "Ejecuta comandos de git en el repositorio actual de forma controlada. Usar este plugin en lugar de shell_exec exclusivo para todo lo relacionado a git.",
    schema: z.object({
      args: z.array(z.string()).describe("Argumentos del comando git, por ejemplo ['commit', '-m', 'Fix']"),
      repo_path: z.string().default(".").describe("Ruta al directorio que contiene el repositorio .git")
    })
  },
  {
    name: "file_metadata",
    description: "Obtiene información de metadatos de un archivo (tamaño, fecha de creación, permisos). No lee ni devuelve el contenido de texto del archivo.",
    schema: z.object({
      path: z.string().describe("Ruta del archivo del cual obtener metadatos")
    })
  },
  {
    name: "python_exec",
    description: "Ejecuta un archivo .py utilizando el entorno Python del proyecto de manera asilada. Preferible frente a shell_exec para lanzar scripts de Python.",
    schema: z.object({
      script_path: z.string().describe("Ruta al archivo Python a ejecutar"),
      args: z.array(z.string()).default([]).describe("Lista de argumentos posicionales para el script")
    })
  },
  {
    name: "directory_list",
    description: "Lista el contenido inmediato de un directorio (solo archivos y subcarpetas). No busca recursivamente y no aplica patrones de filtrado de búsqueda.",
    schema: z.object({
      path: z.string().describe("Ruta del directorio a listar"),
      show_hidden: z.boolean().default(false).describe("Incluir archivos y carpetas ocultas que comienzan con punto")
    })
  },
  {
    name: "json_read",
    description: "Extrae un valor puntual de un archivo JSON usando una ruta de objeto (dot notation). Es más eficiente que leer todo el archivo entero a memoria.",
    schema: z.object({
      path: z.string().describe("Ruta al archivo JSON local"),
      json_path: z.string().describe("Ruta de la propiedad a extraer, ej: 'dependencies.zod'")
    })
  },
  {
    name: "system_metrics",
    description: "Recupera estadísticas de consumo de CPU, memoria RAM y uso de disco de la máquina donde se ejecuta el agente local.",
    schema: z.object({
      include_disk: z.boolean().default(false).describe("Incluir métricas de latencia de entrada/salida del disco duro")
    })
  },
  {
    name: "http_request",
    description: "Realiza una petición HTTP a una URL externa. Útil para verificar servicios de red, consultar APIs, o descargar información remota rápida.",
    schema: z.object({
      url: z.string().describe("Dirección URL completa incluyendo protocolo, ej: 'https://api.ejemplo.com'"),
      method: z.enum(["GET", "POST", "PUT", "DELETE"]).default("GET").describe("Verbo HTTP a utilizar en la solicitud")
    })
  },
  {
    name: "db_query",
    description: "Ejecuta sentencias SQL en la base de datos SQLite local configurada para el proyecto actual. No soporta PostgreSQL ni conexiones a base de datos externa.",
    schema: z.object({
      query: z.string().describe("Consulta SQL completa a ejecutar (ej: SELECT, INSERT, UPDATE)"),
      db_path: z.string().describe("Ruta al archivo local de la base de datos SQLite (.db o .sqlite)")
    })
  },
  {
    name: "dev_server",
    description: "Inicia el servidor local de desarrollo del proyecto. Mantiene el proceso activo en un hilo separado para pruebas manuales o automatizadas.",
    schema: z.object({
      port: z.number().int().min(1024).max(65535).default(3000).describe("Puerto TCP en el que levantará el servidor local"),
      hot_reload: z.boolean().default(true).describe("Habilitar la recarga automática al detectar cambios en archivos")
    })
  },
  {
    name: "unit_test",
    description: "Ejecuta la suite de pruebas unitarias del proyecto y devuelve el resultado detallado. Soporta filtrado por patrón de nombre del bloque de prueba.",
    schema: z.object({
      filter: z.string().optional().describe("Texto o patrón para filtrar los casos de prueba a ejecutar"),
      update_snapshots: z.boolean().default(false).describe("Si es true, actualiza los snapshots visuales de las pruebas que fallen")
    })
  },
  {
    name: "github_issue",
    description: "Abre un issue nuevo en el repositorio de GitHub remoto vinculado al proyecto. Útil para reportar bugs, mejoras o llevar registro de tareas técnicas.",
    schema: z.object({
      title: z.string().describe("Título corto y descriptivo del issue"),
      body: z.string().describe("Cuerpo detallado del issue utilizando el formato Markdown"),
      labels: z.array(z.string()).default([]).describe("Lista de etiquetas para clasificar el issue, ej: ['bug', 'frontend']")
    })
  },
  {
    name: "code_format",
    description: "Formatea automáticamente un archivo de código fuente utilizando las reglas de estilo (Prettier, Black, etc) del entorno del proyecto.",
    schema: z.object({
      file_path: z.string().describe("Ruta al archivo de código fuente a formatear")
    })
  },
  {
    name: "code_lint",
    description: "Ejecuta el analizador estático (linter) sobre un archivo de código en busca de errores y anti-patrones estructurales en la sintaxis.",
    schema: z.object({
      file_path: z.string().describe("Ruta del archivo a analizar"),
      auto_fix: z.boolean().default(false).describe("Si es true, aplica las correcciones automáticas seguras que soporte el linter")
    })
  },
  {
    name: "docker_logs",
    description: "Extrae las líneas finales del registro de eventos (stdout/stderr) de un contenedor de Docker local en ejecución.",
    schema: z.object({
      container_name: z.string().describe("Nombre o identificador parcial del contenedor Docker"),
      lines: z.number().int().min(1).max(5000).default(100).describe("Cantidad máxima de las líneas más recientes a extraer y devolver")
    })
  },
  {
    name: "process_list",
    description: "Consulta los procesos actuales que corren en el sistema operativo local. Es útil para verificar si un servicio de fondo está realmente activo.",
    schema: z.object({
      filter: z.string().optional().describe("Filtro de búsqueda parcial por nombre del proceso ejecutable, ej: 'node' o 'nginx'")
    })
  },
  {
    name: "process_kill",
    description: "Cierra o termina forzosamente un proceso del sistema operativo mediante el envío de señales utilizando su identificador numérico (PID).",
    schema: z.object({
      pid: z.number().int().describe("Identificador numérico (PID) del proceso a terminar"),
      force: z.boolean().default(false).describe("Usa la señal SIGKILL en lugar de SIGTERM si es seteado en true para un cierre abrupto")
    })
  },
  {
    name: "host_ping",
    description: "Envía paquetes ICMP a una dirección de red remota para verificar si un servidor externo está respondiendo, su latencia y si existe pérdida de conexión.",
    schema: z.object({
      host: z.string().describe("Dirección IP o nombre de dominio a diagnosticar"),
      count: z.number().int().min(1).max(10).default(4).describe("Cantidad secuencial de paquetes ICMP a transmitir en la prueba")
    })
  },
  {
    name: "port_scan",
    description: "Verifica qué puertos TCP están abiertos y en estado de escucha en una máquina local o remota especificada para auditar su seguridad o actividad.",
    schema: z.object({
      host: z.string().default("localhost").describe("Dirección IP o dominio a escanear"),
      protocol: z.enum(["tcp", "udp"]).default("tcp").describe("Protocolo de transporte (capa 4) a escanear")
    })
  },
  {
    name: "csv_to_json",
    description: "Convierte una cadena de texto sin procesar en formato CSV a un array de objetos JSON para facilitar su manipulación estructurada dentro del sistema.",
    schema: z.object({
      csv: z.string().describe("Contenido original en bruto en formato de valores separados por el carácter delimitador"),
      delimiter: z.string().default(",").describe("Carácter simple que se utiliza para delimitar las columnas del texto")
    })
  },
  {
    name: "string_hash",
    description: "Genera la representación criptográfica asimétrica en formato hash (unidireccional) de un texto claro utilizando un algoritmo de seguridad especificado.",
    schema: z.object({
      text: z.string().describe("Cadena de texto confidencial en claro para convertir a la suma de hash"),
      algorithm: z.enum(["md5", "sha1", "sha256", "sha512"]).default("sha256").describe("Tipo de algoritmo de hashing seguro a aplicar al texto")
    })
  },
  {
    name: "calendar_event",
    description: "Agenda un nuevo evento o cita de trabajo de duración determinada en el calendario virtual principal del desarrollador autenticado.",
    schema: z.object({
      title: z.string().describe("Título principal o resumen del asunto del evento a crear"),
      datetime_iso: z.string().describe("Fecha y hora exacta de inicio de la reunión en formato estándar ISO 8601"),
      duration_mins: z.number().int().min(5).default(30).describe("Duración estimada en minutos de todo el encuentro")
    })
  },
  {
    name: "slack_message",
    description: "Envía un texto a un canal de Slack público/privado o un mensaje directo a un usuario del equipo. Ideal para notificar de un fallo, avance de tarea o deploy.",
    schema: z.object({
      target: z.string().describe("Nombre textual del canal destino (ej: '#general') o nombre del usuario en la plataforma"),
      message: z.string().describe("Contenido en texto plano o con notación de markdown simplificada a enviar a Slack")
    })
  },
  {
    name: "weather_forecast",
    description: "Obtiene información climática en tiempo real y el pronóstico meteorológico a corto plazo consultando una API externa mediante una ubicación geográfica.",
    schema: z.object({
      location: z.string().describe("Nombre identificatorio de la ciudad (o coordenadas geográficas simples separadas por coma)"),
      unit: z.enum(["celsius", "fahrenheit"]).default("celsius").describe("Preferencia de sistema métrico o imperial para devolver la temperatura")
    })
  },
  {
    name: "text_translate",
    description: "Llama a un servicio remoto de traducción neuronal y convierte de manera precisa una oración o párrafo de un idioma de origen a otro idioma de destino.",
    schema: z.object({
      text: z.string().describe("Cuerpo de texto original que necesita ser analizado y traducido"),
      target_lang: z.string().describe("Código abreviado de idioma de dos letras que se espera (destino), ej: 'es' para español"),
      source_lang: z.string().optional().describe("Código de idioma del texto original. Si no se provee, la API intentará autodetectarlo")
    })
  },
  {
    name: "math_eval",
    description: "Parsea y evalúa algebraicamente una expresión o ecuación en formato de cadena y retorna numéricamente el valor final preciso de la operación completa.",
    schema: z.object({
      expression: z.string().describe("Ecuación, cálculo o expresión matemática simple a computar, ej: '2 + (3 * 4) / 10'")
    })
  },
  {
    name: "uuid_generate",
    description: "Crea de forma aleatoria y estandarizada identificadores universales únicos (UUID) versión 4. Muy útil para inyectar como IDs o tokens de prueba temporales.",
    schema: z.object({
      uppercase: z.boolean().default(false).describe("Si el flag es true, devuelve el UUID generado pero con todos sus caracteres alfabéticos en mayúscula"),
      count: z.number().int().min(1).max(50).default(1).describe("Cantidad numérica de UUIDs diferentes y aleatorios a generar y devolver de una sola vez")
    })
  }
];