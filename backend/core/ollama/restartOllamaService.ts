export class OllamaRestartError extends Error {}

async function run(cmd: string, args: string[]): Promise<void> {
  const command = new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" });
  const { success, stderr } = await command.output();
  if (!success) {
    throw new OllamaRestartError(
      `${cmd} ${args.join(" ")} failed: ${new TextDecoder().decode(stderr).trim()}`,
    );
  }
}

async function restartLinux(kvCacheType: string): Promise<void> {
  const overrideDir = "/etc/systemd/system/ollama.service.d";
  const overridePath = `${overrideDir}/hiveai-kv-cache-type.conf`;
  const overrideContent = `[Service]\nEnvironment="OLLAMA_KV_CACHE_TYPE=${kvCacheType}"\n`;

  const script = [
    `mkdir -p '${overrideDir}'`,
    `printf '%s' '${overrideContent.replace(/'/g, "'\\''")}' > '${overridePath}'`,
    "systemctl daemon-reload",
    "systemctl restart ollama",
  ].join(" && ");

  await run("pkexec", ["sh", "-c", script]);
}

async function restartMacOS(kvCacheType: string): Promise<void> {
  await run("launchctl", ["setenv", "OLLAMA_KV_CACHE_TYPE", kvCacheType]);

  const script = `
    do shell script "pkill -x ollama; open -a Ollama" with administrator privileges
  `;
  await run("osascript", ["-e", script]);
}

async function restartWindows(kvCacheType: string): Promise<void> {
  const script = [
    `Start-Process -Verb RunAs -Wait powershell -ArgumentList '-NoProfile -Command "`,
    `[Environment]::SetEnvironmentVariable(''OLLAMA_KV_CACHE_TYPE'', ''${kvCacheType}'', ''Machine'');`,
    `Stop-Process -Name ollama -Force -ErrorAction SilentlyContinue;`,
    `Start-Process ollama -ArgumentList ''serve''`,
    `"'`,
  ].join(" ");

  await run("powershell", ["-NoProfile", "-Command", script]);
}

export async function restartOllamaService(kvCacheType: string): Promise<void> {
  switch (Deno.build.os) {
    case "linux":
      return await restartLinux(kvCacheType);
    case "darwin":
      return await restartMacOS(kvCacheType);
    case "windows":
      return await restartWindows(kvCacheType);
    default:
      throw new OllamaRestartError(
        `Restarting Ollama is not supported on platform '${Deno.build.os}'`,
      );
  }
}
