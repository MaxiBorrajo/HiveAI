import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  ExternalLink,
  FileCode,
  FileText,
  Image as ImageIcon,
  Table as TableIcon,
  Terminal,
} from "lucide-react";
import type { ExecutionResultType } from "@/types/execution";

interface ResultTheme {
  label: string;
  badgeBg: string;
  icon: ReactNode;
}

function theme(label: string, color: string, Icon: typeof FileText): ResultTheme {
  return {
    label,
    badgeBg: color,
    icon: <Icon className={`size-3.5 ${color.split(" ")[1]}`} />,
  };
}

const RESULT_THEMES: Record<string, ResultTheme> = {
  file: theme("FILE DELIVERABLE", "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", FileText),
  markdown: theme("MARKDOWN REPORT", "bg-cyan-500/10 text-cyan-400 border-cyan-500/20", FileText),
  table: theme("TABULAR DATA", "bg-sky-500/10 text-sky-400 border-sky-500/20", TableIcon),
  json: theme("STRUCTURED JSON", "bg-blue-500/10 text-blue-400 border-blue-500/20", Code2),
  terminal: theme("SHELL OUTPUT", "bg-purple-500/10 text-purple-400 border-purple-500/20", Terminal),
  boolean: theme("DECISION RESULT", "bg-amber-500/10 text-amber-400 border-amber-500/20", CheckCircle2),
  image: theme("GENERATED IMAGE", "bg-pink-500/10 text-pink-400 border-pink-500/20", ImageIcon),
  url: theme("DESTINATION URL", "bg-teal-500/10 text-teal-400 border-teal-500/20", ExternalLink),
  error: theme("EXECUTION ERROR", "bg-rose-500/10 text-rose-400 border-rose-500/20", AlertTriangle),
};

const DEFAULT_THEME = theme("OUTPUT", "bg-zinc-800 text-zinc-300 border-zinc-700", FileCode);

export function getResultTheme(type: ExecutionResultType): ResultTheme {
  return RESULT_THEMES[type] ?? DEFAULT_THEME;
}
