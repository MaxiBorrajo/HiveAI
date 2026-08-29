import { z } from "zod";
import { join } from "node:path";
import { homedir } from "node:os";
import type { BeeContext, BeePlugin } from "../../microkernel/bee-plugin.ts";

const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_RESULTS = 20;
const MAX_CONCURRENCY = 8;

const EXCLUDED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  ".cache",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
  "AppData",
  "$RECYCLE.BIN",
  "System Volume Information",
]);

export default class BuscarArchivosPlugin implements BeePlugin {
  name = "buscar_archivos";
  description =
    "Busca un archivo o carpeta en el sistema por su nombre (o parte del nombre) y devuelve la ruta completa donde se encuentra, si existe. Por defecto busca en las carpetas comunes del usuario (Escritorio, Documentos, Descargas, carpeta de usuario); opcionalmente se le puede indicar una carpeta específica donde buscar.";

  schema = z.object({
    nombre: z
      .string()
      .describe(
        "Nombre del archivo o carpeta a buscar, por ejemplo 'informe.pdf' o 'informe'. La búsqueda no distingue mayúsculas/minúsculas y hace match parcial.",
      ),
    carpeta: z
      .string()
      .optional()
      .describe(
        "Ruta absoluta de una carpeta específica donde buscar. Si se omite, se busca en las carpetas comunes del usuario (Desktop, Documents, Downloads y el home).",
      ),
    maxResultados: z
      .number()
      .int()
      .min(1)
      .default(DEFAULT_MAX_RESULTS)
      .describe("Cantidad máxima de coincidencias a devolver."),
  }) as any;

  initialize(_context: BeeContext): void {}

  private getDefaultSearchDirs(): string[] {
    const home = homedir();
    return [
      join(home, "Desktop"),
      join(home, "Documents"),
      join(home, "Downloads"),
      home,
    ];
  }

  // Recorre `dir` en paralelo (con concurrencia acotada) buscando coincidencias.
  // `matches`/`seen` son compartidos entre todas las ramas para poder cortar
  // apenas se llega a `maxResultados`, sin que cada rama tenga que esperar a las demás.
  private async searchDir(
    dir: string,
    depth: number,
    searchTerm: string,
    matches: string[],
    seen: Set<string>,
    maxResultados: number,
  ): Promise<void> {
    if (depth < 0 || matches.length >= maxResultados) return;

    let entries: Deno.DirEntry[];
    try {
      entries = [];
      for await (const entry of Deno.readDir(dir)) {
        entries.push(entry);
      }
    } catch {
      return;
    }

    const subDirs: string[] = [];

    for (const entry of entries) {
      if (matches.length >= maxResultados) return;

      const fullPath = join(dir, entry.name);

      if (entry.name.toLowerCase().includes(searchTerm) && !seen.has(fullPath)) {
        seen.add(fullPath);
        matches.push(fullPath);
      }

      if (entry.isDirectory && !EXCLUDED_DIR_NAMES.has(entry.name)) {
        subDirs.push(fullPath);
      }
    }

    await this.runWithConcurrency(subDirs, MAX_CONCURRENCY, (subDir) =>
      this.searchDir(subDir, depth - 1, searchTerm, matches, seen, maxResultados),
    );
  }

  private async runWithConcurrency<T>(
    items: T[],
    limit: number,
    task: (item: T) => Promise<void>,
  ): Promise<void> {
    let index = 0;

    async function worker() {
      while (index < items.length) {
        const current = items[index++];
        await task(current);
      }
    }

    const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
    await Promise.all(workers);
  }

  async process(input: unknown): Promise<string> {
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) {
      return `Los parámetros proporcionados son inválidos. Error: ${parsed.error.message}`;
    }

    const { nombre, carpeta, maxResultados } = parsed.data;
    const searchTerm = nombre.toLowerCase();

    const searchDirs = carpeta ? [carpeta] : this.getDefaultSearchDirs();

    if (carpeta) {
      try {
        await Deno.stat(carpeta);
      } catch {
        return `La carpeta indicada no existe o no es accesible: ${carpeta}`;
      }
    }

    const matches: string[] = [];
    const seen = new Set<string>();

    await Promise.all(
      searchDirs.map((dir) =>
        this.searchDir(dir, DEFAULT_MAX_DEPTH, searchTerm, matches, seen, maxResultados),
      ),
    );

    if (matches.length === 0) {
      const donde = carpeta
        ? `en la carpeta '${carpeta}'`
        : "en las carpetas comunes del usuario (Desktop, Documents, Downloads, home)";
      return `No se encontró ningún archivo o carpeta que coincida con '${nombre}' ${donde}.`;
    }

    const limitados = matches.slice(0, maxResultados);
    const lista = limitados.map((p) => `- ${p}`).join("\n");
    return `Se encontraron ${limitados.length} coincidencia(s) para '${nombre}':\n${lista}`;
  }
}
