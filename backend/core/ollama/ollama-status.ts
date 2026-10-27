export type OllamaStatus = "ok" | "not_installed" | "not_running";

export interface OllamaCheck {
  status: OllamaStatus;
  message?: string;
}

const OLLAMA_TAGS_URL = "http://127.0.0.1:11434/api/tags";

async function isInstalled(): Promise<boolean> {
  try {
    const { success } = await new Deno.Command("ollama", {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    }).output();
    return success;
  } catch {
    return false;
  }
}

export async function checkOllama(
  deps: { ping: () => Promise<boolean>; installed: () => Promise<boolean> } = {
    ping: async () => {
      try {
        return (await fetch(OLLAMA_TAGS_URL, { signal: AbortSignal.timeout(3000) })).ok;
      } catch {
        return false;
      }
    },
    installed: isInstalled,
  },
): Promise<OllamaCheck> {
  if (await deps.ping()) return { status: "ok" };
  if (await deps.installed()) {
    return {
      status: "not_running",
      message: "Ollama is installed but not responding. Start it (run 'ollama serve' or open the Ollama app) and try again.",
    };
  }
  return {
    status: "not_installed",
    message: "Ollama is not installed. Install it from https://ollama.com/download and try again.",
  };
}
