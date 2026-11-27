function candidateDirs(): string[] {
  const home = Deno.env.get("HOME") ?? "/";
  return [
    Deno.env.get("OLLAMA_MODELS") ?? "",
    `${home}/.ollama/models`,
    "/usr/share/ollama/.ollama/models",
    home,
    "/",
  ].filter(Boolean);
}

/** Free bytes on the disk holding Ollama's models, or null if unknown. */
export async function getFreeDiskBytes(): Promise<number | null> {
  for (const dir of candidateDirs()) {
    try {
      const out = await new Deno.Command("df", {
        args: ["-Pk", dir],
        stdout: "piped",
        stderr: "null",
      }).output();
      if (!out.success) continue;
      const line = new TextDecoder().decode(out.stdout).trim().split("\n")[1];
      const available = Number(line?.trim().split(/\s+/)[3]);
      if (Number.isFinite(available)) return available * 1024;
    } catch {
      continue;
    }
  }
  return null;
}
