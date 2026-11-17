import { z } from "zod";
import type {
  BeeContext,
  BeePlugin,
  ExecutionTestCase,
  PluginConfigField,
  SelectionTestCase,
} from "./bee-plugin.ts";

/** Image models are slow; on a local CPU an image can take several minutes. */
const CLOUD_TIMEOUT_MS = 180_000;
const LOCAL_TIMEOUT_MS = 600_000;

/**
 * Waiting for a local server that is not there should not delay the turn. On
 * Windows a closed port is not refused at once, so this is what absence costs;
 * a server that is there answers in a fraction of it.
 */
const DETECT_TIMEOUT_MS = 1_500;

type Provider = "auto" | "gemini" | "openai" | "ollama" | "custom";
type FixedProvider = Exclude<Provider, "auto">;

interface ProviderPreset {
  label: string;
  /** Empty for Gemini, which has its own API instead of an OpenAI-style one. */
  baseUrl?: string;
  model?: string;
  needsKey: boolean;
  /** Runs on the user's machine, where it may take minutes. */
  local?: boolean;
}

const PROVIDERS: Record<FixedProvider, ProviderPreset> = {
  gemini: {
    label: "Google Gemini (cloud)",
    model: "gemini-2.5-flash-image",
    needsKey: true,
  },
  openai: {
    label: "OpenAI (cloud)",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-image-1",
    needsKey: true,
  },
  ollama: {
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    model: "x/z-image-turbo",
    needsKey: false,
    local: true,
  },
  custom: {
    label: "Other OpenAI-compatible server",
    needsKey: false,
    local: true,
  },
};

const AUTO_LABEL = "Automatic (finds a generator on this computer)";

/** Where "Automatic" looks, in order. Both speak the OpenAI images API. */
const LOCAL_SERVERS = [
  { name: "Lemonade", baseUrl: "http://localhost:13305/v1" },
  { name: "Ollama", baseUrl: "http://localhost:11434/v1" },
];

/** Ollama does not tag image models, so known image model names stand in. */
const IMAGE_MODEL_NAME =
  /(^|[/:_.-])(sd|sdxl|stable-diffusion|flux|z-image)([/:_.-]|\d|$)/i;

interface ListedModel {
  id: string;
  labels?: string[];
  recipe?: string;
}

function isImageModel(model: ListedModel): boolean {
  return model.labels?.includes("image") === true ||
    model.recipe === "sd-cpp" ||
    IMAGE_MODEL_NAME.test(model.id);
}

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface Settings {
  /** Gemini has its own API; everything else speaks the OpenAI images API. */
  api: "gemini" | "openai";
  label: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  local: boolean;
  /** What to check when the server cannot be reached. */
  unreachableHint: string;
}

interface GeminiInlineData {
  data?: string;
  mimeType?: string;
  mime_type?: string;
}

/** The REST API writes camelCase; snake_case shows up in some responses too. */
interface GeminiPart {
  text?: string;
  inlineData?: GeminiInlineData;
  inline_data?: GeminiInlineData;
}

interface GeneratedImage {
  bytes: Uint8Array;
  mimeType: string;
}

const schema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(4000)
    .describe(
      "A detailed description of the image: subject, setting, style, colors, composition and mood. Write it in English for the best results, even if the user wrote in another language.",
    ),
  fileName: z
    .string()
    .optional()
    .describe(
      "A short name for the file, without extension, e.g. 'sunset-over-the-sea'. The extension comes from the image format.",
    ),
});

type GenerateImageSchema = typeof schema;

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Servers do not always say what they returned, so look at the bytes. */
function sniffImageType(bytes: Uint8Array): string | undefined {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "image";
}

async function errorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const body = JSON.parse(text);
    const message = body?.error?.message ?? body?.error ?? body?.message;
    if (typeof message === "string" && message) return message;
  } catch {
    // Not JSON: fall back to the raw text.
  }
  return text.slice(0, 300) || res.statusText;
}

export default class GenerateImagePlugin implements BeePlugin<GenerateImageSchema> {
  name = "generate_image";
  description =
    "Creates an image from a text description and attaches it to your reply, where the user can see and download it. USE CASES: the user asks you to draw, generate, create, design or illustrate a picture, logo, icon, illustration, poster or photo-like image (e.g. 'draw a cat in space', 'make me a logo for my bakery', 'generate an image of...'). Do NOT use it to describe or analyze an image the user sent, to find existing images on the web, or to make charts or diagrams from data (write a file for those instead).";

  schema = schema;
  returnDescription =
    "Returns a plain-text confirmation with the file name and size of the generated image, or an error explaining what is missing (for example, the API key) or what the provider refused.";

  configFields: PluginConfigField[] = [
    {
      key: "provider",
      label: "Provider",
      secret: false,
      options: [
        { value: "auto", label: AUTO_LABEL },
        ...(Object.keys(PROVIDERS) as FixedProvider[]).map((value) => ({
          value,
          label: PROVIDERS[value].label,
        })),
      ],
      placeholder: AUTO_LABEL,
      description:
        "Automatic uses Lemonade or Ollama if one is running here, with no setup. Cloud providers need an API key.",
    },
    {
      key: "model",
      label: "Model",
      secret: false,
      placeholder: "Picked for you",
      description: "Leave it empty to use the provider's default, or the first image model found.",
    },
    {
      key: "apiKey",
      label: "API key",
      secret: true,
      description: "Needed for Gemini and OpenAI. Not needed for Ollama.",
    },
    {
      key: "baseUrl",
      label: "Server URL",
      secret: false,
      placeholder: "http://localhost:11434/v1",
      description: "Only for Ollama on another port or another OpenAI-compatible server (e.g. Lemonade: http://localhost:13305/v1).",
    },
  ];

  private context?: BeeContext;

  constructor(private fetchFn: typeof fetch = fetch) {}

  initialize(context: BeeContext): void {
    this.context = context;
  }

  async process(
    input: z.infer<GenerateImageSchema>,
    options?: { signal?: AbortSignal },
  ): Promise<string> {
    if (!this.context) throw new Error("The plugin was not initialized.");
    const settings = await this.readSettings();
    this.context.reportStep(`Generating an image with ${settings.model} (${settings.label})`);

    const signal = AbortSignal.any([
      AbortSignal.timeout(settings.local ? LOCAL_TIMEOUT_MS : CLOUD_TIMEOUT_MS),
      ...(options?.signal ? [options.signal] : []),
    ]);
    const image = settings.api === "gemini"
      ? await this.generateWithGemini(settings, input.prompt, signal)
      : await this.generateWithOpenAICompatible(settings, input.prompt, signal);

    const kilobytes = Math.max(1, Math.round(image.bytes.length / 1024));
    const file = await this.context.createFile(
      input.fileName?.trim() || slugify(input.prompt),
      image.bytes,
      image.mimeType,
    );
    if (!file) {
      return `Generated a ${kilobytes} KB image with ${settings.model}, but there is no chat or run to attach it to.`;
    }
    return `Generated the image '${file.fileName}' (${kilobytes} KB) with ${settings.model} and attached it to your reply, where the user can see and download it. Mention it briefly; do not describe it at length or invent details about it.`;
  }

  private async readSettings(): Promise<Settings> {
    const get = async (key: string) =>
      (await this.context!.getConfig(key))?.trim() || undefined;
    const provider = ((await get("provider")) ?? "auto") as Provider;
    if (provider === "auto") return await this.detectLocal(await get("model"));

    const preset = PROVIDERS[provider];
    if (!preset) {
      throw new Error(`Unknown image provider '${provider}'. Pick one in the generate_image plugin settings.`);
    }

    const settings: Settings = {
      api: provider === "gemini" ? "gemini" : "openai",
      label: preset.label,
      model: (await get("model")) ?? preset.model ?? "",
      apiKey: await get("apiKey"),
      baseUrl: ((await get("baseUrl")) ?? preset.baseUrl)?.replace(/\/+$/, ""),
      local: preset.local === true,
      unreachableHint: provider === "ollama"
        ? "Check that Ollama is running and has the model pulled."
        : preset.local
        ? "Check the server URL and that the server is running."
        : "Check your connection.",
    };
    if (preset.needsKey && !settings.apiKey) {
      throw new Error(
        `Image generation is not set up: add the ${preset.label} API key in the generate_image plugin settings, or switch the provider to Automatic to generate on this computer.`,
      );
    }
    if (!settings.model) {
      throw new Error("Image generation is not set up: set the model in the generate_image plugin settings.");
    }
    if (settings.api !== "gemini" && !settings.baseUrl) {
      throw new Error("Image generation is not set up: set the server URL in the generate_image plugin settings.");
    }
    return settings;
  }

  /** Uses the first local server that has an image model, so nothing needs setting up. */
  private async detectLocal(model?: string): Promise<Settings> {
    // Asked together so absent servers cost one wait, not one each.
    const listings = await Promise.all(
      LOCAL_SERVERS.map((server) => this.listModels(server.baseUrl)),
    );
    const running: string[] = [];
    for (const [i, server] of LOCAL_SERVERS.entries()) {
      const models = listings[i];
      if (!models) continue;
      running.push(server.name);
      const chosen = model
        ? models.find((m) => m.id === model)
        : models.find(isImageModel);
      if (chosen) {
        return {
          api: "openai",
          label: `${server.name} (local)`,
          model: chosen.id,
          baseUrl: server.baseUrl,
          local: true,
          unreachableHint: `Check that ${server.name} is still running.`,
        };
      }
    }

    if (running.length > 0) {
      const wanted = model ? `the model '${model}'` : "an image model";
      throw new Error(
        `Found ${running.join(" and ")} on this computer, but not ${wanted}. Download SD-Turbo in Lemonade (small, runs on most computers), or pick a cloud provider in the generate_image plugin settings.`,
      );
    }
    throw new Error(
      "No image generator was found on this computer. Install Lemonade Server and download SD-Turbo to generate images locally, or pick a cloud provider and add its API key in the generate_image plugin settings.",
    );
  }

  /** The server's models, or undefined when nothing answers there. */
  private async listModels(baseUrl: string): Promise<ListedModel[] | undefined> {
    try {
      const res = await this.fetchFn(`${baseUrl}/models`, {
        signal: AbortSignal.timeout(DETECT_TIMEOUT_MS),
      });
      if (!res.ok) return undefined;
      const body = await res.json();
      return Array.isArray(body?.data) ? body.data : undefined;
    } catch {
      return undefined;
    }
  }

  private async generateWithGemini(
    settings: Settings,
    prompt: string,
    signal: AbortSignal,
  ): Promise<GeneratedImage> {
    const res = await this.request(
      `${GEMINI_BASE}/${encodeURIComponent(settings.model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": settings.apiKey!,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
        signal,
      },
      "Google Gemini",
    );
    const body = await res.json();
    const parts: GeminiPart[] = body?.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      const inline = part.inlineData ?? part.inline_data;
      if (inline?.data) {
        const bytes = decodeBase64(inline.data);
        return {
          bytes,
          mimeType: sniffImageType(bytes) ?? inline.mimeType ?? inline.mime_type ?? "image/png",
        };
      }
    }
    // No image: the text or the block reason says why (e.g. a safety filter).
    const said = parts.map((p) => p.text).filter(Boolean).join(" ").trim();
    const blocked = body?.promptFeedback?.blockReason ??
      body?.candidates?.[0]?.finishReason;
    throw new Error(
      `Google Gemini did not return an image${blocked ? ` (${blocked})` : ""}${said ? `: ${said}` : "."} Check that '${settings.model}' is an image model.`,
    );
  }

  private async generateWithOpenAICompatible(
    settings: Settings,
    prompt: string,
    signal: AbortSignal,
  ): Promise<GeneratedImage> {
    const label = settings.label;
    const res = await this.request(
      `${settings.baseUrl}/images/generations`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: settings.model, prompt, n: 1 }),
        signal,
      },
      label,
      settings.unreachableHint,
    );
    const body = await res.json();
    const item = body?.data?.[0];
    let bytes: Uint8Array | undefined;
    if (typeof item?.b64_json === "string") {
      bytes = decodeBase64(item.b64_json);
    } else if (typeof item?.url === "string") {
      // Some servers answer with a link instead of the bytes.
      const image = await this.request(item.url, { signal }, label);
      bytes = new Uint8Array(await image.arrayBuffer());
    }
    if (!bytes) throw new Error(`${label} did not return an image.`);
    const mimeType = sniffImageType(bytes);
    if (!mimeType) throw new Error(`${label} returned something that is not an image.`);
    return { bytes, mimeType };
  }

  private async request(
    url: string,
    init: RequestInit,
    label: string,
    unreachableHint = "Check your connection.",
  ): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchFn(url, init);
    } catch (error) {
      if (init.signal?.aborted) {
        throw new Error(`${label} took too long to generate the image, or it was stopped.`);
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not reach ${label} at ${new URL(url).origin} (${detail}). ${unreachableHint}`,
      );
    }
    if (!res.ok) {
      throw new Error(`${label} rejected the request (HTTP ${res.status}): ${await errorDetail(res)}`);
    }
    return res;
  }

  selectionTests: SelectionTestCase<GenerateImageSchema>[] = [
    {
      query: "draw a cat floating in space with a tiny helmet",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "generate an image of a cozy cabin in a snowy forest at night",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "make me a minimalist logo for a bakery called Pan Dulce",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "what is in this photo I attached?",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "find me pictures of the Eiffel Tower on the web",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "write a CSV with the monthly sales figures",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "make a chart of my expenses this year",
      kind: "ambiguous",
    },
    {
      query: "I need something visual for my presentation about bees",
      kind: "ambiguous",
    },
    {
      query: "can you design a cover for my report?",
      kind: "ambiguous",
    },
  ];

  executionTests: ExecutionTestCase<GenerateImageSchema>[] = [
    {
      description: "Simple subject",
      kind: "happy",
      params: { prompt: "A red apple on a wooden table, soft daylight" },
      expect: (output: string) => output.startsWith("Generated"),
    },
    {
      description: "With an explicit file name",
      kind: "happy",
      params: { prompt: "A lighthouse at sunset, watercolor style", fileName: "lighthouse" },
      expect: (output: string) => output.startsWith("Generated"),
    },
    {
      description: "Logo-style request",
      kind: "happy",
      params: { prompt: "A flat, minimalist bee logo in yellow and black" },
      expect: (output: string) => output.startsWith("Generated"),
    },
    {
      description: "File name with an extension that may not match the format",
      kind: "edge",
      params: { prompt: "A blue circle on a white background", fileName: "circle.gif" },
      expect: (output: string) => output.startsWith("Generated"),
    },
    {
      description: "File name with path characters",
      kind: "edge",
      params: { prompt: "A green triangle", fileName: "../../shapes/triangle" },
      expect: (output: string) => output.startsWith("Generated") && !output.includes(".."),
    },
    {
      description: "Prompt in another language",
      kind: "edge",
      params: { prompt: "Un perro corriendo en la playa, estilo acuarela" },
      expect: (output: string) => output.startsWith("Generated"),
    },
    {
      description: "Empty prompt",
      kind: "error",
      params: { prompt: "" },
      expect: (output: string) => output.startsWith("ERROR"),
    },
    {
      description: "Prompt far too long",
      kind: "error",
      params: { prompt: "a".repeat(5000) },
      expect: (output: string) => output.startsWith("ERROR"),
    },
    {
      description: "Missing prompt",
      kind: "error",
      params: {} as z.infer<GenerateImageSchema>,
      expect: (output: string) => output.startsWith("ERROR"),
    },
  ];
}
