export class OllamaRestartError extends Error {}

const OLLAMA_HEALTH_URL = "http://127.0.0.1:11434/api/tags";
const HEALTH_CHECK_TIMEOUT_MS = 30_000;
const HEALTH_CHECK_INTERVAL_MS = 500;

async function waitUntilOllamaIsReady(): Promise<void> {
  const deadline = Date.now() + HEALTH_CHECK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(OLLAMA_HEALTH_URL);
      if (response.ok) return;
    } catch {
      // Not up yet — keep polling until the timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS));
  }

  throw new OllamaRestartError(
    `Ollama did not become ready within ${HEALTH_CHECK_TIMEOUT_MS / 1000}s after restarting`,
  );
}

async function run(cmd: string, args: string[]): Promise<void> {
  const command = new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" });
  const { success, stderr } = await command.output();
  if (!success) {
    throw new OllamaRestartError(
      `${cmd} ${args.join(" ")} failed: ${new TextDecoder().decode(stderr).trim()}`,
    );
  }
}

async function restartLinux(kvCacheType: string | null): Promise<void> {
  const overrideDir = "/etc/systemd/system/ollama.service.d";
  const overridePath = `${overrideDir}/hiveai-kv-cache-type.conf`;

  const applyStep =
    kvCacheType === null
      ? `rm -f '${overridePath}'`
      : (() => {
          const overrideContent = `[Service]\nEnvironment="OLLAMA_KV_CACHE_TYPE=${kvCacheType}"\n`;
          return [
            `mkdir -p '${overrideDir}'`,
            `printf '%s' '${overrideContent.replace(/'/g, "'\\''")}' > '${overridePath}'`,
          ].join(" && ");
        })();

  const script = [applyStep, "systemctl daemon-reload", "systemctl restart ollama"].join(
    " && ",
  );

  await run("pkexec", ["sh", "-c", script]);
}

async function restartMacOS(kvCacheType: string | null): Promise<void> {
  if (kvCacheType === null) {
    await run("launchctl", ["unsetenv", "OLLAMA_KV_CACHE_TYPE"]);
  } else {
    await run("launchctl", ["setenv", "OLLAMA_KV_CACHE_TYPE", kvCacheType]);
  }

  const script = `
    do shell script "pkill -x ollama; open -a Ollama" with administrator privileges
  `;
  await run("osascript", ["-e", script]);
}

async function restartWindows(kvCacheType: string | null): Promise<void> {
  const setEnvStep =
    kvCacheType === null
      ? `[Environment]::SetEnvironmentVariable(''OLLAMA_KV_CACHE_TYPE'', $null, ''Machine'');`
      : `[Environment]::SetEnvironmentVariable(''OLLAMA_KV_CACHE_TYPE'', ''${kvCacheType}'', ''Machine'');`;

  const script = [
    `Start-Process -Verb RunAs -Wait powershell -ArgumentList '-NoProfile -Command "`,
    setEnvStep,
    `Stop-Process -Name ollama -Force -ErrorAction SilentlyContinue;`,
    `Start-Process ollama -ArgumentList ''serve''`,
    `"'`,
  ].join(" ");

  await run("powershell", ["-NoProfile", "-Command", script]);
}

export async function restartOllamaService(
  kvCacheType: string | null,
): Promise<void> {
  switch (Deno.build.os) {
    case "linux":
      await restartLinux(kvCacheType);
      break;
    case "darwin":
      await restartMacOS(kvCacheType);
      break;
    case "windows":
      await restartWindows(kvCacheType);
      break;
    default:
      throw new OllamaRestartError(
        `Restarting Ollama is not supported on platform '${Deno.build.os}'`,
      );
  }

  await waitUntilOllamaIsReady();
}
