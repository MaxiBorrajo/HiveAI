export type FileKind =
  | "image"
  | "pdf"
  | "word"
  | "sheet"
  | "slides"
  | "markdown"
  | "json"
  | "html"
  | "code"
  | "text"
  | "other";

/** Extension → highlight.js language, for code files shown with colors. */
const CODE_LANGUAGES: Record<string, string> = {
  py: "python",
  js: "javascript",
  mjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cs: "csharp",
  go: "go",
  rs: "rust",
  rb: "ruby",
  php: "php",
  sh: "bash",
  bash: "bash",
  ps1: "powershell",
  sql: "sql",
  css: "css",
  scss: "scss",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  kt: "kotlin",
  swift: "swift",
};

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function fileKind(name: string, mimeType: string): FileKind {
  const extension = extensionOf(name);
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf" || extension === "pdf") return "pdf";
  if (["doc", "docx"].includes(extension) || mimeType.includes("wordprocessing")) return "word";
  if (["xls", "xlsx", "csv"].includes(extension) || mimeType.includes("spreadsheet") || mimeType === "text/csv") {
    return "sheet";
  }
  if (["ppt", "pptx"].includes(extension) || mimeType.includes("presentation")) return "slides";
  if (["md", "markdown"].includes(extension) || mimeType === "text/markdown") return "markdown";
  if (extension === "json" || mimeType === "application/json") return "json";
  if (["html", "htm"].includes(extension) || mimeType === "text/html") return "html";
  if (extension in CODE_LANGUAGES) return "code";
  if (mimeType.startsWith("text/")) return "text";
  return "other";
}

export function codeLanguage(name: string): string {
  const extension = extensionOf(name);
  return CODE_LANGUAGES[extension] ?? (extension === "json" ? "json" : extension === "html" ? "html" : "");
}

/** Tile color for each kind, in the spirit of the usual app colors (red PDF, blue Word, green sheets). */
export const KIND_STYLES: Record<FileKind, string> = {
  image: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  pdf: "bg-red-500/15 text-red-600 dark:text-red-400",
  word: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  sheet: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  slides: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  markdown: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
  json: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  html: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
  code: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  text: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
  other: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
};

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
