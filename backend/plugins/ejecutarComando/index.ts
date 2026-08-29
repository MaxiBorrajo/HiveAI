import { z } from "zod";
import type { BeeContext, BeePlugin } from "../../microkernel/bee-plugin.ts";

const MAX_OUTPUT_CHARS = 4000;

// Solo comandos de solo lectura / navegación. Nada que borre, mueva,
// escriba, cambie permisos, ni ejecute red o procesos arbitrarios.

// Builtins de cmd.exe: no son ejecutables propios, solo existen dentro
// de una shell de Windows. Se invocan como `cmd /c <comando> <args>`.
const WINDOWS_BUILTINS = new Set(["dir", "cd", "type", "echo", "ver", "vol"]);

// Ejecutables reales (tienen su propio .exe / binario en el PATH).
const REAL_EXECUTABLES = new Set([
  // Windows
  "where",
  "whoami",
  "hostname",
  "systeminfo",
  "tasklist",
  // Unix / cross
  "ls",
  "pwd",
  "cat",
  "which",
  "uname",
  "ps",
  "df",
  "du",
  "date",
  "env",
  "find",
]);

const ALLOWED_COMMANDS = new Set([
  ...WINDOWS_BUILTINS,
  ...REAL_EXECUTABLES,
]);

export default class EjecutarComandoPlugin implements BeePlugin {
  name = "ejecutar_comando";
  description =
    "Ejecuta un comando de consola de solo lectura para inspeccionar el sistema (listar archivos, ver directorio actual, imprimir contenido de un archivo, etc). Solo permite comandos de navegación/consulta de una lista fija; cualquier comando de borrado, escritura, movimiento o modificación está prohibido y será rechazado.";

  schema = z.object({
    comando: z
      .string()
      .describe(
        "Nombre del comando a ejecutar, por ejemplo 'ls', 'dir', 'pwd', 'cat'. Debe ser un comando permitido de solo lectura.",
      ),
    argumentos: z
      .array(z.string())
      .default([])
      .describe(
        "Lista de argumentos para el comando, por ejemplo ['-la'] o ['C:\\\\Users']. No se admite un solo string con el comando completo, sino argumentos separados.",
      ),
    cwd: z
      .string()
      .optional()
      .describe(
        "Directorio absoluto desde el cual ejecutar el comando. Si se omite, se usa el directorio actual del proceso.",
      ),
  }) as any;

  initialize(_context: BeeContext): void {}

  async process(input: unknown): Promise<string> {
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) {
      return `Los parámetros proporcionados son inválidos. Error: ${parsed.error.message}`;
    }

    const { comando, argumentos, cwd } = parsed.data;
    const commandName = comando.trim().toLowerCase();

    if (!ALLOWED_COMMANDS.has(commandName)) {
      return `El comando '${comando}' no está permitido. Solo se pueden ejecutar comandos de consulta/navegación de solo lectura: ${Array.from(
        ALLOWED_COMMANDS,
      ).join(", ")}.`;
    }

    for (const arg of argumentos) {
      if (/[;&|`$><]/.test(arg)) {
        return `El argumento '${arg}' contiene caracteres no permitidos (operadores de shell). Los argumentos deben pasarse individualmente, sin encadenar comandos.`;
      }
    }

    const isWindows = Deno.build.os === "windows";
    const useCmdShell = isWindows && WINDOWS_BUILTINS.has(commandName);

    try {
      const command = useCmdShell
        ? new Deno.Command("cmd", {
            args: ["/d", "/c", commandName, ...argumentos],
            cwd: cwd || undefined,
            stdout: "piped",
            stderr: "piped",
          })
        : new Deno.Command(commandName, {
            args: argumentos,
            cwd: cwd || undefined,
            stdout: "piped",
            stderr: "piped",
          });

      const { code, stdout, stderr } = await command.output();

      const decoder = new TextDecoder();
      let output = decoder.decode(stdout).trim();
      const errorOutput = decoder.decode(stderr).trim();

      if (output.length > MAX_OUTPUT_CHARS) {
        output = `${output.slice(0, MAX_OUTPUT_CHARS)}\n...(salida truncada)`;
      }

      if (code !== 0) {
        return `El comando '${comando}' finalizó con código ${code}. Error: ${
          errorOutput || "(sin detalle)"
        }`;
      }

      return output || "(el comando no produjo salida)";
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        const plataforma = isWindows ? "Windows" : Deno.build.os;
        return `El comando '${comando}' no existe en este sistema (${plataforma}). Comandos disponibles: ${Array.from(
          ALLOWED_COMMANDS,
        ).join(", ")}.`;
      }
      return `Ocurrió un error al ejecutar el comando: ${(error as Error).message}`;
    }
  }
}
