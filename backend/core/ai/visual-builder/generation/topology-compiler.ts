import { ChatOllama } from "@langchain/ollama";
import { AIMessage, BaseMessage, SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { runConfigStep } from "./generation-step.ts";
import { PluginInfo, WorkflowSkeleton } from "../types.ts";


export function normalizePluginName(
  rawName: string | undefined,
  availablePlugins: PluginInfo[],
): string | undefined {
  if (!rawName) return undefined;
  const target = rawName.toLowerCase().trim().replace(/[-_]/g, "");
  const directMatch = availablePlugins.find(
    (p) => p.name.toLowerCase().replace(/[-_]/g, "") === target,
  );
  if (directMatch) return directMatch.name;

  const partialMatch = availablePlugins.find(
    (p) =>
      p.name.toLowerCase().includes(target) ||
      target.includes(p.name.toLowerCase().replace(/[-_]/g, "")),
  );
  if (partialMatch) return partialMatch.name;

  return undefined;
}

export function buildWorkflowSkeletonSchema(availablePlugins: PluginInfo[]) {
  const pluginNames = availablePlugins.map((p) => p.name);
  const pluginEnum =
    pluginNames.length > 0
      ? z.enum(pluginNames as [string, ...string[]])
      : z.string();

  return z.object({
    thought: z
      .string()
      .describe(
        "Explanation of the workflow architecture, steps, condition branches and loops",
      ),
    nodes: z
      .array(
        z.object({
          id: z
            .string()
            .describe(
              "Unique lowercase identifier (e.g. search_news, analyze_metrics, anomaly_check). DO NOT use 'start' or 'end'.",
            ),
          name: z
            .string()
            .describe(
              "Clear, concise title (e.g. 'Search News', 'Analyze Metrics', 'Is Anomaly Detected?'). DO NOT name 'Start' or 'End'.",
            ),
          type: z
            .enum(["plugin", "llm", "condition"])
            .describe(
              "Node type: 'plugin' for a single deterministic tool action with fully pre-determined static parameters; 'llm' for cognitive reasoning — either pure (no tools) or an autonomous agent equipped with one or more tools invoked in a dynamic observe->act loop (set 'plugins'); 'condition' for if/else routing diamond",
            ),
          pluginId: pluginEnum
            .optional()
            .describe(
              `Plugin ID if type is 'plugin'. MUST be one of the registered plugins: [${pluginNames.join(", ")}]`,
            ),
          plugins: z
            .array(pluginEnum)
            .optional()
            .describe(
              `ONLY for 'llm' nodes that need an active tool loop (autonomous agent behavior). Leave empty/omitted for pure reasoning/summarizing llm nodes. Available: [${pluginNames.join(", ")}]`,
            ),
          description: z
            .string()
            .describe("What this specific node does in the flow"),
        }),
      )
      .min(1)
      .describe(
        "Intermediate functional nodes between Start and End (start and end are built-in and must not be in this list)",
      ),
    edges: z
      .array(
        z.object({
          source: z
            .string()
            .describe("Source node ID ('start' or any intermediate node id)"),
          target: z
            .string()
            .describe("Target node ID (any intermediate node id, or 'end')"),
          path: z
            .enum(["true", "false"])
            .optional()
            .describe(
              "MANDATORY if source is a condition node ('true' for pass/proceed, 'false' for loop-back/retry or alert branch); omit for any other source",
            ),
        }),
      )
      .describe(
        "Directed connections between nodes, including loops and condition true/false paths",
      ),
  });
}

/**
 * Phase 1: runs the Topology Compiler LLM call (via runConfigStep) to design
 * the whole workflow's node/edge structure in one structured-output call.
 * If the call fails after its retries the error propagates to the caller.
 */
export async function runTopologyCompilerPhase(
  prompt: string,
  modelName: string,
  availablePlugins: PluginInfo[],
  correctionContext?: { previousSkeleton: WorkflowSkeleton; violations: string[] },
): Promise<WorkflowSkeleton> {
  const workflowSkeletonSchema = buildWorkflowSkeletonSchema(availablePlugins);

  // Topology Compiler: decides the whole workflow's node/edge structure in
  // one structured-output call.
  const compilerAgent = new ChatOllama({
    model: modelName,
    temperature: 0.1,
  }).withStructuredOutput(workflowSkeletonSchema, {
    name: "TopologyCompiler",
  });

  const compilerPrompt = `You are the Workflow Topology Compiler for an AI Agent Visual Builder.
Given the User's Objective and available plugins, design the complete node/edge structure of this workflow.

Host Operating System: "${Deno.build.os}". Ensure any tool or shell steps you design are compatible with this operating system.

Available Plugins and their parameter schemas:
${availablePlugins
  .map(
    (p) =>
      `- ${p.name}: ${p.description}\n  Parameters: ${p.parametersDescription || "none"}${p.returnDescription ? `\n  Returns: ${p.returnDescription}` : ""}`,
  )
  .join("\n")}

CRITICAL ARCHITECTURE RULES:
1. Built-in Entry & Exit Terminals: "start" and "end" already exist. DO NOT create any node named "start"/"Start"/"end"/"End" — only the functional steps in between. The first node's source edge is "start"; the last node's target edge is "end".
2. Node Archetypes:
   - "plugin": ONLY for a step that executes exactly ONE tool call with fully pre-determined, static parameters — no decisions, no branching, no adaptation. Never chain two raw plugin nodes directly if semantic translation, filtering, or decision-making is needed between them — use an "llm" node instead.
   - "llm": cognitive reasoning. Either pure (consumes data already produced, reasons, produces new data, no tools) — leave "plugins" empty; OR an autonomous agent equipped with one or more tools ("plugins" set), invoked in a dynamic observe -> act -> evaluate -> act loop. Use the agent form whenever a step involves MULTIPLE related tool actions where the result of one action determines what to do next, or the node must retry/refine/cross-reference across tool outputs.
   - "condition": an if/else routing decision evaluating a typed value, with exactly two outgoing edges (path="true"/"false").
3. CRITICAL — DO NOT FRAGMENT ONE AGENT'S TOOL CHAIN INTO SEPARATE NODES: if a tool call's inputs or repetition count depend on a PRIOR tool call's result within the same logical task (e.g. "search for something, then read N of the resulting items"), describe ALL of those tool calls as belonging to ONE "llm" node with "plugins" set to ALL the needed tools — not as a standalone plugin node, followed by a node that only picks which items to use, followed by more standalone plugin nodes to fetch each item. That fragmentation forces later nodes to consume a piece of a list/object they cannot cleanly reference, and duplicates work the agent could do itself.
   - WRONG (fragmented): node 1 "search the web" (plugin) -> node 2 "pick the 2 best links" (llm) -> node 3 "read link 1" (plugin) -> node 4 "read link 2" (plugin) -> node 5 "compare" (llm)
   - RIGHT (collapsed): node 1 "search the web for the topic, pick the 2 most relevant results, and read each one" — ONE "llm" node with plugins [web_search, web_read], producing one clear output -> node 2 "compare the two articles" (llm) -> node 3 "save to file" (plugin)
   - Only use a standalone "plugin" node for a tool call whose parameters are ALREADY fully known before the workflow runs — never for a tool call whose target depends on a previous node's dynamic output.
4. Data Interpolation Constraint (affects what a later node can read): a later node can only read an EARLIER node's output as a whole value — it CANNOT reach into one specific field of a list/object produced earlier (e.g. it cannot pick "the first URL" out of a list by itself). If a later node needs one specific field/item out of a list/object an earlier node produced, you MUST insert an intermediate "llm" node whose ONLY job is to read that full list/object and extract JUST the one field/item it needs, producing that as its own simple output. Never assume a node can reach into nested structure by itself.
5. Condition Patterns: a branching decision node always has exactly two outcomes (pass/fail, true/false) — both must be wired, including whether the "false" branch ends the workflow or loops back to retry an earlier node.
6. Design between 2 and 5 real functional nodes that fully satisfy the user's objective.
7. Tool Adequacy Check (MANDATORY — do not skip): before finalizing each node's plugin choice, verify the chosen plugin's description and "Returns" text actually satisfies the LITERAL objective (e.g. searching file CONTENT vs. searching file NAMES are different capabilities — never conflate them). If NO available plugin can literally satisfy a node's requirement, select the closest available plugin that CAN (e.g. prefer "run_shell" with grep/find over a name-only file search plugin for content-based search) — do NOT use a plugin you have identified as inadequate just because it seemed superficially related. If truly no plugin can satisfy the requirement even approximately, say so explicitly in "thought" instead of silently using an inadequate one.
8. Use clean, descriptive lowercase IDs (e.g. 'search_news', 'analyze_metrics', 'anomaly_check').
9. Explicit "agent" wording is a HARD signal, not a suggestion: if the user's objective names a step with the word "agent"/"agente" (e.g. "an agent with web_search...", "un agente equipado con..."), that step MUST be an "llm" node with "plugins" set to the named tool(s) — NEVER a standalone "plugin" node, even if the step happens to call only one tool. The user explicitly asked for agentic (reasoning + tool-use) behavior there, not a raw mechanical call.
10. A verb like "draft"/"redactar", "write"/"escribir", "summarize"/"resumir", "compose"/"componer", "synthesize" describes COGNITIVE SYNTHESIS, not a mechanical tool call — a plugin like "web_search" only returns raw search snippets, it cannot itself "draft" or "write" anything coherent. Any step whose description contains one of these synthesis verbs together with a tool need (e.g. "search AND draft", "read AND summarize") MUST be an "llm" node with that tool in "plugins" — the tool fetches raw material, the LLM reasoning is what actually produces the requested prose.

WORKED EXAMPLES (study the REASONING in each, not just the shape — apply the same judgment to the actual objective below):

Example A — Judgment/evaluation step must be "llm", never a stateful plugin:
  User objective: "...search recent CVEs for a library, then evaluate if any are critical (boolean is_vulnerable)..."
  WRONG: a "plugin" node with pluginId "counter" trying to "increment" or "read" a count from the search text — "counter" only manages a persisted numeric counter by name, it cannot read/judge free text at all, and there is no real count to increment here.
  RIGHT: an "llm" node (no plugins needed — pure reasoning over the search results already in state) with outputKey "is_vulnerable", instructed to output ONLY true/false based on reading the CVE text for critical severity.
  Rule of thumb: if the step's verb is evaluate/determine/decide/classify/assess/score/judge, it is ALWAYS "llm" — never force it into an available plugin just because one exists.

Example B — "read X, extract Y, then save Y" is TWO steps, not one plugin call:
  User objective: "...an agent with web_read reads the CVE report, extracts the patched version, and file-ops saves a cve_advisory.json..."
  WRONG: a single "plugin" node with pluginId "web_read" whose output is saved directly — this saves the RAW page text, never actually extracting the patched version the objective asked for.
  RIGHT: one "llm" node with plugins: ["web_read"] that reads the report AND reasons out the specific extracted fact (e.g. outputKey "patched_version_info") -> THEN a separate "plugin" node with pluginId "file_ops" (operation "write") that saves that extracted output, not the raw page.
  Rule of thumb: "extract/summarize/parse X from Y" is always cognitive work — it needs an "llm" step, even when a tool fetches the raw data first.

Example C — A condition's two branches must fully diverge to "end", never re-merge:
  User objective: "...if no vulnerabilities, generate an approval certificate and finish; if vulnerabilities exist, process the CVE advisory and save it..."
  WRONG: edges condition->certificate_node (false) -> cve_node (true's target) -> end — this silently forces the "approved" path through the "vulnerable" path's logic.
  RIGHT: condition->certificate_node (false) -> end, AND separately condition->cve_node (true) -> end. Each branch reaches "end" through its OWN nodes only; they never feed into each other.

Example D — Numeric quality gates use "number", not a boolean flag:
  User objective: "...an LLM rates technical depth 1-10 as quality_score; if quality_score >= 8, save and finish; otherwise loop back to rewrite..."
  WRONG: outputKey "is_good_enough" (boolean) with condition operator "equals" true/false — this discards the actual numeric scale the user asked for.
  RIGHT: the "llm" node's outputKey is "quality_score", producing a real number (not a 0/1 flag); the "condition" node's field is "quality_score" with a numeric operator ("greater_than_or_equals") and a numeric value (8, not "8" or true/false). Use "string" outputs the same way for category/label judgments (e.g. field "severity", operator "equals", value "critical") — only use a boolean when the objective is a literal yes/no question.`;

  const messages: BaseMessage[] = [
    new SystemMessage(compilerPrompt),
    new HumanMessage(`User Objective: "${prompt}"`),
  ];

  if (correctionContext) {
    messages.push(
      new AIMessage(JSON.stringify(correctionContext.previousSkeleton)),
      new HumanMessage(
        `That workflow structure is invalid:\n${correctionContext.violations.map((v) => `- ${v}`).join("\n")}\nFix ALL of the issues above and answer again with a corrected node/edge structure.`,
      ),
    );
  }

  return runConfigStep<WorkflowSkeleton, WorkflowSkeleton>({
    label: "Topology Compiler",
    agent: compilerAgent,
    messages,
    onSuccess: (skeleton) => {
      console.log(
        `[Visual Builder - Generator] Architecture designed: ${skeleton.nodes.length} nodes, ${skeleton.edges.length} edges`,
      );
      return skeleton;
    },
    onFallback: (err: unknown) => {
      console.error(`[Visual Builder - Generator] Topology Compiler failed:`, err instanceof Error ? err.message : err);
      throw err;
    },
  });
}
