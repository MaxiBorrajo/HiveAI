import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { BeeContext } from "../../../../core/microkernel/bee-plugin.ts";
import GenerateImagePlugin from "../../../../plugins/generate-image/index.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

interface Created {
  fileName: string;
  bytes: Uint8Array;
  mimeType: string;
}

interface Call {
  url: string;
  init?: RequestInit;
}

/** A plugin wired to fake settings and a fake network, recording what it does. */
function setup(
  config: Record<string, string>,
  respond: (call: Call) => Response,
  attach = true,
) {
  const calls: Call[] = [];
  const created: Created[] = [];
  const fakeFetch = ((input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    // A throwing responder stands for a server that is not there.
    return Promise.resolve().then(() => respond(call));
  }) as typeof fetch;

  const context: BeeContext = {
    getDataDir: () => "",
    getModel: () => "test-model",
    requestApproval: () => Promise.resolve(true),
    reportStep: () => {},
    getConfig: (key) => Promise.resolve(config[key]),
    createFile: (fileName, bytes, mimeType) => {
      if (!attach) return Promise.resolve(null);
      created.push({ fileName, bytes, mimeType });
      return Promise.resolve({ fileName: `${fileName}.png`, sizeBytes: bytes.length });
    },
  };
  const plugin = new GenerateImagePlugin(fakeFetch);
  plugin.initialize(context);
  return { plugin, calls, created };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const geminiImage = (bytes: Uint8Array) =>
  json({
    candidates: [{
      content: {
        parts: [
          { text: "Here is your image." },
          { inlineData: { mimeType: "image/png", data: base64(bytes) } },
        ],
      },
    }],
  });

const headersOf = (call: Call) => new Headers(call.init?.headers);

Deno.test("generate_image: Gemini generates the image and it is attached to the reply", async () => {
  const { plugin, calls, created } = setup({ provider: "gemini", apiKey: "gemini-key" }, () => geminiImage(PNG));

  const output = await plugin.process({ prompt: "A lighthouse", fileName: "lighthouse" });

  assertEquals(calls.length, 1);
  assertStringIncludes(calls[0].url, "/models/gemini-2.5-flash-image:generateContent");
  assertEquals(headersOf(calls[0]).get("x-goog-api-key"), "gemini-key");
  const body = JSON.parse(String(calls[0].init?.body));
  assertEquals(body.contents[0].parts[0].text, "A lighthouse");
  assertEquals(body.generationConfig.responseModalities, ["TEXT", "IMAGE"]);

  assertEquals(created.length, 1);
  assertEquals(created[0].fileName, "lighthouse");
  assertEquals(created[0].mimeType, "image/png");
  assertEquals(created[0].bytes, PNG);
  assert(output.startsWith("Generated the image 'lighthouse.png'"), output);
});

Deno.test("generate_image: without a file name, one is made from the prompt", async () => {
  const { plugin, created } = setup({ provider: "gemini", apiKey: "k" }, () => geminiImage(PNG));

  await plugin.process({ prompt: "Un perro corriendo en la playa!" });

  assertEquals(created[0].fileName, "un-perro-corriendo-en-la-playa");
});

Deno.test("generate_image: a cloud provider without its key says how to set it up, and calls nothing", async () => {
  const { plugin, calls } = setup({ provider: "openai" }, () => json({}));

  await assertRejects(
    () => plugin.process({ prompt: "A cat" }),
    Error,
    "add the OpenAI (cloud) API key",
  );
  assertEquals(calls.length, 0);
});

Deno.test("generate_image: Ollama runs locally, with no key, on its OpenAI-compatible endpoint", async () => {
  const { plugin, calls, created } = setup(
    { provider: "ollama" },
    () => json({ data: [{ b64_json: base64(JPEG) }] }),
  );

  await plugin.process({ prompt: "A red apple" });

  assertEquals(calls[0].url, "http://localhost:11434/v1/images/generations");
  assertEquals(headersOf(calls[0]).get("authorization"), null);
  const body = JSON.parse(String(calls[0].init?.body));
  assertEquals(body.model, "x/z-image-turbo");
  assertEquals(body.prompt, "A red apple");
  assertEquals(created[0].mimeType, "image/jpeg", "the type comes from the bytes");
});

Deno.test("generate_image: a custom server uses its URL, model and key, and may answer with a link", async () => {
  const { plugin, calls, created } = setup(
    {
      provider: "custom",
      baseUrl: "http://localhost:8080/v1/",
      model: "sdxl",
      apiKey: "local-key",
    },
    (call) =>
      call.url.endsWith("/images/generations")
        ? json({ data: [{ url: "http://localhost:8080/files/out.png" }] })
        : new Response(PNG),
  );

  await plugin.process({ prompt: "A green triangle" });

  assertEquals(calls.map((c) => c.url), [
    "http://localhost:8080/v1/images/generations",
    "http://localhost:8080/files/out.png",
  ]);
  assertEquals(headersOf(calls[0]).get("authorization"), "Bearer local-key");
  assertEquals(JSON.parse(String(calls[0].init?.body)).model, "sdxl");
  assertEquals(created[0].bytes, PNG);
});

Deno.test("generate_image: a provider error reaches the model with its reason", async () => {
  const { plugin } = setup(
    { provider: "gemini", apiKey: "bad" },
    () => json({ error: { message: "API key not valid." } }, 400),
  );

  await assertRejects(
    () => plugin.process({ prompt: "A cat" }),
    Error,
    "rejected the request (HTTP 400): API key not valid.",
  );
});

Deno.test("generate_image: when Gemini answers without an image, it says why", async () => {
  const { plugin } = setup(
    { provider: "gemini", apiKey: "k" },
    () =>
      json({
        candidates: [{
          finishReason: "IMAGE_SAFETY",
          content: { parts: [{ text: "I can't create that image." }] },
        }],
      }),
  );

  const error = await assertRejects(() => plugin.process({ prompt: "Something" }), Error);
  assertStringIncludes(error.message, "IMAGE_SAFETY");
  assertStringIncludes(error.message, "I can't create that image.");
});

Deno.test("generate_image: a reply that is not an image is refused, not attached", async () => {
  const { plugin, created } = setup(
    { provider: "ollama" },
    () => json({ data: [{ b64_json: btoa("<html>oops</html>") }] }),
  );

  await assertRejects(
    () => plugin.process({ prompt: "A cat" }),
    Error,
    "not an image",
  );
  assertEquals(created.length, 0);
});

Deno.test("generate_image: Ollama not running gets a hint to start it", async () => {
  const calls: string[] = [];
  const plugin = new GenerateImagePlugin(((input: string | URL | Request) => {
    calls.push(String(input));
    return Promise.reject(new TypeError("Connection refused"));
  }) as typeof fetch);
  plugin.initialize({
    getDataDir: () => "",
    getModel: () => "",
    requestApproval: () => Promise.resolve(true),
    reportStep: () => {},
    getConfig: (key) => Promise.resolve(key === "provider" ? "ollama" : undefined),
    createFile: () => Promise.resolve(null),
  });

  await assertRejects(
    () => plugin.process({ prompt: "A cat" }),
    Error,
    "Check that Ollama is running",
  );
  assertEquals(calls.length, 1);
});

Deno.test("generate_image: with nowhere to attach it (a plugin test), it still reports the image", async () => {
  const { plugin } = setup({ provider: "gemini", apiKey: "k" }, () => geminiImage(PNG), false);

  const output = await plugin.process({ prompt: "A cat" });

  assert(output.startsWith("Generated a 1 KB image"), output);
  assertStringIncludes(output, "no chat or run to attach it to");
});

Deno.test("generate_image: the provider is picked from a list, and only the key is secret", () => {
  const plugin = new GenerateImagePlugin();
  const fields = new Map(plugin.configFields.map((f) => [f.key, f]));

  assertEquals(
    fields.get("provider")?.options?.map((o) => o.value),
    ["auto", "gemini", "openai", "ollama", "custom"],
  );
  assertEquals(
    plugin.configFields.filter((f) => f.secret !== false).map((f) => f.key),
    ["apiKey"],
  );
});

const LEMONADE = "http://localhost:13305/v1";
const OLLAMA = "http://localhost:11434/v1";
const refused = () => {
  throw new TypeError("Connection refused");
};

Deno.test("generate_image: Automatic is the default and finds Lemonade's image model by its label", async () => {
  const { plugin, calls, created } = setup({}, (call) => {
    if (call.url === `${LEMONADE}/models`) {
      return json({
        data: [
          { id: "Qwen3-8B-GGUF", labels: ["reasoning"], recipe: "llamacpp" },
          { id: "SD-Turbo", labels: ["image"], recipe: "sd-cpp" },
        ],
      });
    }
    if (call.url === `${LEMONADE}/images/generations`) {
      return json({ data: [{ b64_json: base64(PNG) }] });
    }
    return refused();
  });

  const output = await plugin.process({ prompt: "A cat" });

  // Both servers are asked at once; Lemonade comes first in preference.
  const generations = calls.filter((c) => c.url.endsWith("/images/generations"));
  assertEquals(generations.map((c) => c.url), [`${LEMONADE}/images/generations`]);
  assertEquals(JSON.parse(String(generations[0].init?.body)).model, "SD-Turbo");
  assertEquals(created.length, 1);
  assert(output.startsWith("Generated the image"), output);
});

Deno.test("generate_image: Automatic falls back to Ollama, spotting image models by name", async () => {
  const { plugin, calls } = setup({}, (call) => {
    if (call.url === `${OLLAMA}/models`) {
      return json({ data: [{ id: "qwen3:8b" }, { id: "x/z-image-turbo" }] });
    }
    if (call.url === `${OLLAMA}/images/generations`) {
      return json({ data: [{ b64_json: base64(PNG) }] });
    }
    return refused();
  });

  await plugin.process({ prompt: "A cat" });

  assertEquals(JSON.parse(String(calls.at(-1)?.init?.body)).model, "x/z-image-turbo");
});

Deno.test("generate_image: Automatic says what is missing when the servers have no image model", async () => {
  const { plugin, calls } = setup({}, (call) =>
    call.url.endsWith("/models")
      ? json({ data: [{ id: "qwen3:8b" }, { id: "llava:7b" }] })
      : refused()
  );

  await assertRejects(
    () => plugin.process({ prompt: "A cat" }),
    Error,
    "Found Lemonade and Ollama on this computer, but not an image model",
  );
  assert(calls.every((c) => c.url.endsWith("/models")), "nothing was generated");
});

Deno.test("generate_image: Automatic with nothing running points to Lemonade or a cloud provider", async () => {
  const { plugin } = setup({}, refused);

  await assertRejects(
    () => plugin.process({ prompt: "A cat" }),
    Error,
    "No image generator was found on this computer",
  );
});

Deno.test("generate_image: Automatic with a chosen model uses the server that has it", async () => {
  const { plugin, calls } = setup({ model: "flux2-klein" }, (call) => {
    if (call.url === `${LEMONADE}/models`) {
      return json({ data: [{ id: "SD-Turbo", labels: ["image"] }] });
    }
    if (call.url === `${OLLAMA}/models`) return json({ data: [{ id: "flux2-klein" }] });
    if (call.url === `${OLLAMA}/images/generations`) {
      return json({ data: [{ b64_json: base64(PNG) }] });
    }
    return refused();
  });

  await plugin.process({ prompt: "A cat" });

  assertEquals(calls.at(-1)?.url, `${OLLAMA}/images/generations`);
  assertEquals(JSON.parse(String(calls.at(-1)?.init?.body)).model, "flux2-klein");
});
