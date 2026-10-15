import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildLinuxScript,
  EMPTY_OLLAMA_SERVER_ENV,
} from "../../../../core/ollama/restart-ollama-service.ts";

Deno.test("buildLinuxScript - writes every set variable into one drop-in and restarts once", () => {
  const script = buildLinuxScript({
    OLLAMA_KV_CACHE_TYPE: "q8_0",
    OLLAMA_FLASH_ATTENTION: "1",
  });

  assertStringIncludes(script, "OLLAMA_KV_CACHE_TYPE=q8_0");
  assertStringIncludes(script, "OLLAMA_FLASH_ATTENTION=1");
  assertEquals(script.split("systemctl restart ollama").length - 1, 1);
});

Deno.test("buildLinuxScript - with nothing set removes the drop-in", () => {
  const script = buildLinuxScript(EMPTY_OLLAMA_SERVER_ENV);

  assertStringIncludes(script, "rm -f '/etc/systemd/system/ollama.service.d/hiveai-server-env.conf'");
  assertEquals(script.includes("OLLAMA_"), false);
});

Deno.test("buildLinuxScript - only sets the variables that are not null", () => {
  const script = buildLinuxScript({
    OLLAMA_KV_CACHE_TYPE: null,
    OLLAMA_FLASH_ATTENTION: "1",
  });

  assertEquals(script.includes("OLLAMA_KV_CACHE_TYPE"), false);
  assertStringIncludes(script, "OLLAMA_FLASH_ATTENTION=1");
});
