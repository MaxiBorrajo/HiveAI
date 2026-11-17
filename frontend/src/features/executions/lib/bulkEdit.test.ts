import { describe, expect, it } from "vitest";
import { applyBulkEdit, isEmptyEdit, modelOf, sameModel, shared } from "./bulkEdit";
import { updateNodeConfigs } from "./graphOps";
import type { LangGraphAbstraction } from "../types";

const prompt = { systemPrompt: "Summarize ${draft}", outputKey: "summary", inputMapping: { draft: "draft" } };

describe("applyBulkEdit", () => {
  it("switches the model and leaves the node's own settings alone", () => {
    const config = { ...prompt, model: "qwen3:8b" };
    const next = applyBulkEdit(config, { model: { model: "gpt-5", provider: "openai", keyId: "k1" } });
    expect(next).toEqual({ ...prompt, model: "gpt-5", provider: "openai", keyId: "k1" });
  });

  it("going to a local model drops the cloud provider and key", () => {
    const config = { model: "gpt-5", provider: "openai", keyId: "k1" };
    expect(applyBulkEdit(config, { model: { model: "qwen3:8b" } })).toEqual({ model: "qwen3:8b" });
  });

  it("null means back to the default model", () => {
    const next = applyBulkEdit({ model: "gpt-5", provider: "openai", keyId: "k1" }, { model: null });
    expect(modelOf(next)).toBeNull();
  });

  it("sets or clears the max tokens", () => {
    expect(applyBulkEdit({}, { maxTokens: 800 }).maxTokens).toBe(800);
    expect(applyBulkEdit({ maxTokens: 800 }, { maxTokens: null }).maxTokens).toBeUndefined();
  });

  it("equips and takes off tools, keeping the rest of each node's tools", () => {
    const next = applyBulkEdit(
      { plugins: ["web_search", "run_shell"] },
      { plugins: { run_shell: false, file_read: true, web_search: true } },
    );
    expect(next.plugins).toEqual(["web_search", "file_read"]);
  });

  it("an untouched field keeps what each node has", () => {
    const config = { ...prompt, model: "qwen3:8b", maxTokens: 300, plugins: ["web_search"] };
    expect(applyBulkEdit(config, {})).toEqual(config);
    expect(isEmptyEdit({})).toBe(true);
    expect(isEmptyEdit({ plugins: {} })).toBe(true);
    expect(isEmptyEdit({ model: null })).toBe(false);
  });
});

describe("shared", () => {
  it("tells a value everyone agrees on from a mix", () => {
    expect(shared([3, 3])).toEqual({ mixed: false, value: 3 });
    expect(shared([3, 4])).toEqual({ mixed: true });
    const a = modelOf({ model: "gpt-5", provider: "openai", keyId: "k1" });
    const b = modelOf({ model: "gpt-5", provider: "openai", keyId: "k2" });
    expect(shared([a, a && { ...a }], sameModel).mixed).toBe(false);
    expect(shared([a, b], sameModel).mixed).toBe(true);
  });
});

describe("updateNodeConfigs", () => {
  it("rewrites only the nodes it is given", () => {
    const graph: LangGraphAbstraction = {
      nodes: [
        { id: "a", name: "A", type: "llm", config: { model: "x", outputKey: "a_out" } },
        { id: "b", name: "B", type: "llm", config: { model: "y", outputKey: "b_out" } },
        { id: "c", name: "C", type: "llm", config: { model: "z", outputKey: "c_out" } },
      ],
      edges: [],
      stateSchema: {},
    };
    const next = updateNodeConfigs(graph, ["a", "c", "missing"], (config) => ({ ...config, model: "new" }));
    expect(next.nodes.map((n) => n.config.model)).toEqual(["new", "y", "new"]);
    expect(next.nodes[0].config.outputKey).toBe("a_out");
  });
});
