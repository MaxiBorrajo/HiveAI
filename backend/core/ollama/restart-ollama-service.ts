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
    } catch {}
    await new Promise((resolve) =>
      setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS),
    );
  }

  throw new OllamaRestartError(
    `Ollama did not become ready within ${HEALTH_CHECK_TIMEOUT_MS / 1000}s after restarting`,
  );
}

async function run(cmd: string, args: string[]): Promise<void> {
  const command = new Deno.Command(cmd, {
    args,
    stdout: "piped",
    stderr: "piped",
  });
  const { success, stderr } = await command.output();
  if (!success) {
    throw new OllamaRestartError(
      `${cmd} ${args.join(" ")} failed: ${new TextDecoder().decode(stderr).trim()}`,
    );
  }
}

export interface OllamaServerEnv {
  OLLAMA_KV_CACHE_TYPE: string | null;
  OLLAMA_FLASH_ATTENTION: string | null;
}

export const EMPTY_OLLAMA_SERVER_ENV: OllamaServerEnv = {
  OLLAMA_KV_CACHE_TYPE: null,
  OLLAMA_FLASH_ATTENTION: null,
};

const ENV_NAMES = Object.keys(EMPTY_OLLAMA_SERVER_ENV) as (keyof OllamaServerEnv)[];

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildLinuxScript(env: OllamaServerEnv): string {
  const overrideDir = "/etc/systemd/system/ollama.service.d";
  const overridePath = `${overrideDir}/hiveai-server-env.conf`;
  const legacyPath = `${overrideDir}/hiveai-kv-cache-type.conf`;

  const lines = ENV_NAMES.filter((name) => env[name] !== null).map(
    (name) => `Environment="${name}=${env[name]}"`,
  );

  const applyStep =
    lines.length === 0
      ? `rm -f ${shellQuote(overridePath)}`
      : [
          `mkdir -p ${shellQuote(overrideDir)}`,
          `printf '%s' ${shellQuote(`[Service]\n${lines.join("\n")}\n`)} > ${shellQuote(overridePath)}`,
        ].join(" && ");

  return [
    `rm -f ${shellQuote(legacyPath)}`,
    applyStep,
    "systemctl daemon-reload",
    "systemctl restart ollama",
  ].join(" && ");
}

async function restartLinux(env: OllamaServerEnv): Promise<void> {
  await run("pkexec", ["sh", "-c", buildLinuxScript(env)]);
}

async function restartMacOS(env: OllamaServerEnv): Promise<void> {
  for (const name of ENV_NAMES) {
    const value = env[name];
    if (value === null) await run("launchctl", ["unsetenv", name]);
    else await run("launchctl", ["setenv", name, value]);
  }

  const script = `
    do shell script "pkill -x ollama; open -a Ollama" with administrator privileges
  `;
  await run("osascript", ["-e", script]);
}

async function restartWindows(env: OllamaServerEnv): Promise<void> {
  const setEnvSteps = ENV_NAMES.map((name) => {
    const value = env[name];
    return value === null
      ? `[Environment]::SetEnvironmentVariable(''${name}'', $null, ''Machine'');`
      : `[Environment]::SetEnvironmentVariable(''${name}'', ''${value}'', ''Machine'');`;
  });

  const script = [
    `Start-Process -Verb RunAs -Wait powershell -ArgumentList '-NoProfile -Command "`,
    ...setEnvSteps,
    `Stop-Process -Name ollama -Force -ErrorAction SilentlyContinue;`,
    `Start-Process ollama -ArgumentList ''serve''`,
    `"'`,
  ].join(" ");

  await run("powershell", ["-NoProfile", "-Command", script]);
}

export async function restartOllamaService(
  env: OllamaServerEnv,
): Promise<void> {
  switch (Deno.build.os) {
    case "linux":
      await restartLinux(env);
      break;
    case "darwin":
      await restartMacOS(env);
      break;
    case "windows":
      await restartWindows(env);
      break;
    default:
      throw new OllamaRestartError(
        `Restarting Ollama is not supported on platform '${Deno.build.os}'`,
      );
  }

  await waitUntilOllamaIsReady();
}
