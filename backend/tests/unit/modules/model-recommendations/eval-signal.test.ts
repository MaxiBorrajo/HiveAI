import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { loadEvalSignals } from "../../../../modules/model-recommendations/lib/eval-signal.ts";
import { DEFAULT_CATALOG } from "../../../../modules/model-recommendations/lib/default-catalog.ts";
import type { Candidate } from "../../../../modules/model-recommendations/types.ts";

const cand = (model: string): Candidate => ({
  ref: { provider: "ollama", model },
  label: model,
  location: "local",
  vision: "unsupported",
  tools: "supported",
});

Deno.test("loadEvalSignals - averages the mapped categories; unevaluated models and unmapped tasks give no signal", async () => {
  const dir = await Deno.makeTempDir();
  const prev = Deno.env.get("HIVEAI_EVAL_DIR");
  Deno.env.set("HIVEAI_EVAL_DIR", dir);
  try {
    await Deno.mkdir(join(dir, "profiles"), { recursive: true });
    await Deno.writeTextFile(join(dir, "profiles", "qwen3-8b.json"), JSON.stringify({
      model: "qwen3:8b",
      latest: { summarization: { value: 0.8, lowConfidence: false } },
      history: {},
    }));
    const signals = await loadEvalSignals([cand("qwen3:8b"), cand("llama3.1:8b")], DEFAULT_CATALOG, "summarization");
    assertEquals(signals, { "ollama:qwen3:8b": { value: 0.8, lowConfidence: false } });
    assertEquals(await loadEvalSignals([cand("qwen3:8b")], DEFAULT_CATALOG, "chat"), {});
  } finally {
    if (prev === undefined) Deno.env.delete("HIVEAI_EVAL_DIR");
    else Deno.env.set("HIVEAI_EVAL_DIR", prev);
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
