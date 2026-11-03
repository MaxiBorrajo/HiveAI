import { assertEquals } from "@std/assert";
import {
  estimateQ4Bytes,
  isChatCandidate,
  parseModel,
  parseQuantizations,
  quantFromFilename,
} from "../../../../modules/model-discovery/lib/parse-model.ts";
import { cleanReadme, summarizeReadme } from "../../../../modules/model-discovery/lib/readme-summary.ts";

Deno.test("parseModel - reads params, context, license and capabilities", () => {
  const card = parseModel({
    id: "unsloth/Qwen3-8B-GGUF",
    downloads: 10,
    likes: 2,
    tags: ["gguf", "license:apache-2.0"],
    gguf: {
      total: 8190735360,
      architecture: "qwen3",
      context_length: 40960,
      chat_template: "{%- if tools %}...{% endif %}<think>",
    },
  });
  assertEquals(card.ollamaName, "hf.co/unsloth/Qwen3-8B-GGUF");
  assertEquals(card.paramsBillions, 8.2);
  assertEquals(card.contextLength, 40960);
  assertEquals(card.license, "apache-2.0");
  assertEquals(card.capabilities, { tools: true, vision: false, reasoning: true });
});

Deno.test("parseModel - no tools in the chat template means no tool support; vision from pipeline tag", () => {
  const card = parseModel({
    id: "a/b",
    pipeline_tag: "image-text-to-text",
    gguf: { chat_template: "{{ messages }}" },
  });
  assertEquals(card.capabilities, { tools: false, vision: true, reasoning: false });
});

Deno.test("isChatCandidate - drops embedding models", () => {
  assertEquals(isChatCandidate({ id: "a", pipeline_tag: "feature-extraction" }), false);
  assertEquals(isChatCandidate({ id: "a", pipeline_tag: "text-generation" }), true);
  assertEquals(isChatCandidate({ id: "a" }), true);
});

Deno.test("quantFromFilename - recognises common quantizations", () => {
  assertEquals(quantFromFilename("Qwen3-8B-Q4_K_M.gguf"), "Q4_K_M");
  assertEquals(quantFromFilename("Qwen3-8B-IQ4_XS.gguf"), "IQ4_XS");
  assertEquals(quantFromFilename("Qwen3-8B-Q8_0.gguf"), "Q8_0");
  assertEquals(quantFromFilename("Qwen3-8B-BF16.gguf"), "BF16");
  assertEquals(quantFromFilename("UD-Q4_K_XL/model-00001-of-00002.gguf"), null);
  assertEquals(quantFromFilename("Qwen3-8B-UD-Q4_K_XL.gguf"), "Q4_K_XL");
});

Deno.test("parseQuantizations - sums split files, skips mmproj and non-gguf", () => {
  const quants = parseQuantizations("u/r", [
    { type: "file", path: ".gitattributes", size: 10 },
    { type: "file", path: "r-Q4_K_M.gguf", size: 5000 },
    { type: "file", path: "r-Q8_0-00001-of-00002.gguf", size: 4000 },
    { type: "file", path: "r-Q8_0-00002-of-00002.gguf", size: 3000 },
    { type: "file", path: "mmproj-F16.gguf", size: 999 },
    { type: "directory", path: "sub", size: 0 },
  ]);
  assertEquals(quants, [
    { name: "Q4_K_M", sizeBytes: 5000, ollamaName: "hf.co/u/r:Q4_K_M" },
    { name: "Q8_0", sizeBytes: 7000, ollamaName: "hf.co/u/r:Q8_0" },
  ]);
});

Deno.test("estimateQ4Bytes - ~0.6 bytes per parameter, null when unknown", () => {
  assertEquals(estimateQ4Bytes(null), null);
  assertEquals(estimateQ4Bytes(1)! > 5e8, true);
});

const README = `---
license: apache-2.0
---
<div align="center"><img src="x.png"></div>

# LFM3-1.7B

![badge](https://x/y.svg)

LFM3-1.7B is a text model for local agents and specialized applications, based on a new tri-hybrid architecture.

| col | col |
|---|---|
| a | b |

**Designed for the edge:** at 4-bit precision it takes about 1 GB of memory, so it fits on any phone or laptop.
`;

Deno.test("summarizeReadme - keeps the first prose paragraphs, drops front matter, html, headings and tables", () => {
  const s = summarizeReadme(README);
  assertEquals(s.startsWith("LFM3-1.7B is a text model"), true);
  assertEquals(s.includes("license:"), false);
  assertEquals(s.includes("<div"), false);
  assertEquals(s.includes("| col"), false);
});

Deno.test("cleanReadme - removes front matter and html but keeps markdown", () => {
  const c = cleanReadme(README);
  assertEquals(c.startsWith("# LFM3-1.7B"), true);
  assertEquals(c.includes("<img"), false);
});

Deno.test("summarizeReadme - skips navigation paragraphs made of HTML links", () => {
  const md = `<p>See our <a href="https://x.y/collection">collection</a> for all versions of this model family.</p>

<p>Learn to run it correctly - <a href="https://x.y/guide">Read our Guide</a> for more information.</p>

Qwen3 is the latest generation of large language models with dense and mixture-of-experts variants.`;
  assertEquals(summarizeReadme(md).startsWith("Qwen3 is the latest generation"), true);
});
