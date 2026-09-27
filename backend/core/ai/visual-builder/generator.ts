import { ChatOllama } from "@langchain/ollama";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import {
  LangGraphAbstraction,
  GraphNode,
  GraphEdge,
  NodeType,
} from "./types.ts";
import { z } from "zod";

const statePropertyDefinitionSchema = z.object({
  type: z.enum(["string", "number", "boolean", "object", "array"]),
  description: z.string().optional(),
  default: z.any().optional(),
  required: z.boolean().default(false),
  reducerStrategy: z
    .enum(["overwrite", "append", "merge_dict", "sum"])
    .optional(),
});

export interface PluginInfo {
  name: string;
  description: string;
  parametersDescription?: string;
  parameterKeys?: string[];
  requiredKeys?: string[];
  returnDescription?: string;
}

const RESERVED_NODE_NAMES = [
  "start",
  "end",
  "start_step",
  "end_step",
  "start_node",
  "end_node",
];

const edgeConditionSchema = z
  .object({
    field: z.string().describe("State property to evaluate"),
    operator: z.enum([
      "equals",
      "not_equals",
      "greater_than",
      "greater_than_or_equals",
      "less_than",
      "less_than_or_equals",
      "contains",
      "not_contains",
      "starts_with",
      "ends_with",
      "is_empty",
      "is_not_empty",
      "in",
      "not_in",
      "regex_match",
    ]),
    value: z.unknown(),
  })
  .describe("Condition required to traverse the edge.");

/**
 * Normalizes plugin names (case-insensitive, ignoring dashes vs underscores).
 */
function normalizePluginName(
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

/**
 * Dynamic Zod schema for Phase 1: Workflow Skeleton.
 * Relaxed and resilient to prevent local LLM formatting glitches from crashing generation.
 */
function buildWorkflowSkeletonSchema(availablePlugins: PluginInfo[]) {
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
            .enum(["plugin", "llm", "agent", "condition"])
            .describe(
              "Node type: 'plugin' for a single deterministic tool action; 'llm' for pure cognitive reasoning (no external tools); 'agent' for a goal-driven autonomous agent that combines multiple tools in a dynamic loop to research, explore, or iterate; 'condition' for if/else routing diamond",
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
              `ONLY for 'agent' type nodes. List the tools the agent can invoke autonomously. Available: [${pluginNames.join(", ")}]`,
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
            .string()
            .optional()
            .describe(
              "MANDATORY if source is a condition node ('true' for pass/proceed, 'false' for loop-back/retry or alert branch)",
            ),
        }),
      )
      .describe(
        "Directed connections between nodes, including loops and condition true/false paths",
      ),
  });
}

/**
 * Intelligent heuristic fallback builder when architect LLM call fails or times out.
 * Dynamically pairs user prompt with available plugins based on descriptions and schemas,
 * without hardcoding any specific plugin names.
 */
function buildHeuristicSkeleton(
  prompt: string,
  availablePlugins: PluginInfo[],
) {
  const pLower = prompt.toLowerCase();
  const promptTokens = pLower.split(/[^a-z0-9_]+/).filter((t) => t.length > 2);

  // Score available plugins dynamically by keyword overlap with their name and description
  const scoredPlugins = availablePlugins
    .map((plugin) => {
      const searchTarget = `${plugin.name} ${plugin.description} ${plugin.parametersDescription || ""}`.toLowerCase();
      let score = 0;
      for (const token of promptTokens) {
        if (searchTarget.includes(token)) {
          score += 1;
        }
      }
      return { plugin, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.plugin);

  const hasCondition = /condition|condici[oó]n|if\b|si\b|evalu|branch|bifurca|check|verif|retry|reintento|bucle|loop/i.test(prompt);

  // Pattern A: Conditional workflow / branching / retry loop
  if (hasCondition) {
    const isLoopback = /retry|reintento|bucle|loop|corrija|repeat/i.test(prompt);
    const firstTool = scoredPlugins[0];
    const secondTool = scoredPlugins[1];
    const saveTool = scoredPlugins.find((p) => /save|write|store|log|file/i.test(`${p.name} ${p.description}`));

    const nodes: any[] = [
      {
        id: "initial_step",
        name: "Initial Processing",
        type: firstTool && !/save|write|store/i.test(firstTool.description) ? "plugin" : "llm",
        ...(firstTool && !/save|write|store/i.test(firstTool.description) ? { pluginId: firstTool.name } : {}),
        description: "Process initial input or generate work",
      },
      {
        id: "verification_step",
        name: "Verification & Evaluation",
        type: secondTool ? "plugin" : "llm",
        ...(secondTool ? { pluginId: secondTool.name } : {}),
        description: "Verify quality, syntax, or conditions",
      },
      {
        id: "quality_gate",
        name: "Quality Gate",
        type: "condition" as const,
        description: "Branch based on verification result",
      },
      {
        id: "finalize_step",
        name: "Finalize Deliverable",
        type: saveTool ? "plugin" : "llm",
        ...(saveTool ? { pluginId: saveTool.name } : {}),
        description: "Save result or produce finalized output",
      },
    ];

    const edges: any[] = [
      { source: "start", target: "initial_step" },
      { source: "initial_step", target: "verification_step" },
      { source: "verification_step", target: "quality_gate" },
    ];

    if (isLoopback) {
      edges.push(
        { source: "quality_gate", target: "finalize_step", path: "true" },
        { source: "quality_gate", target: "initial_step", path: "false" },
        { source: "finalize_step", target: "end" },
      );
    } else {
      edges.push(
        { source: "quality_gate", target: "finalize_step", path: "true" },
        { source: "quality_gate", target: "end", path: "false" },
        { source: "finalize_step", target: "end" },
      );
    }

    return {
      thought: "Creating dynamic conditional workflow matching available tools",
      nodes,
      edges,
    };
  }

  // Pattern B: Multi-step linear tool pipeline
  if (scoredPlugins.length > 1) {
    const nodes = scoredPlugins.slice(0, 3).map((plugin, idx) => ({
      id: `step_${idx + 1}_${plugin.name.replace(/[^a-zA-Z0-9_]/g, "_")}`,
      name: `Execute ${plugin.name}`,
      type: "plugin" as const,
      pluginId: plugin.name,
      description: plugin.description,
    }));

    const edges: any[] = [{ source: "start", target: nodes[0].id }];
    for (let i = 0; i < nodes.length - 1; i++) {
      edges.push({ source: nodes[i].id, target: nodes[i + 1].id });
    }
    edges.push({ source: nodes[nodes.length - 1].id, target: "end" });

    return {
      thought: "Creating sequential tool execution pipeline",
      nodes,
      edges,
    };
  }

  // Pattern C: Autonomous Agent equipped with matched tools
  const toolsToGive = scoredPlugins.slice(0, 4).map((p) => p.name);
  return {
    thought: "Creating resilient AI agent workflow with available tools",
    nodes: [
      {
        id: "main_agent",
        name: "AI Agent",
        type: "llm" as const,
        plugins: toolsToGive.length > 0 ? toolsToGive : undefined,
        description: "Process input and accomplish objective using tools",
      },
    ],
    edges: [
      { source: "start", target: "main_agent" },
      { source: "main_agent", target: "end" },
    ],
  };
}

/**
 * Dynamic Zod schema for configuring a Plugin node.
 * Allows inputMapping to contain both state variable references and static literals.
 */
function buildPluginConfigSchema(availablePlugins: PluginInfo[]) {
  const pluginNames = availablePlugins.map((p) => p.name);
  const pluginEnum =
    pluginNames.length > 0
      ? z.enum(pluginNames as [string, ...string[]])
      : z.string();

  return z.object({
    nodeId: z
      .string()
      .describe("Unique lowercase alphanumeric ID for this node"),
    nodeName: z
      .string()
      .describe("Human readable name (e.g. 'Search Google', 'Save Alert Log')"),
    pluginId: pluginEnum
      .describe(
        `The plugin ID to use. Available: [${pluginNames.join(", ")}]. MUST be one of these exact names!`,
      ),
    inputMapping: z
      .record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean()]),
      )
      .optional()
      .describe(
        "Map plugin parameter names to flat primitive values: either state variable references (e.g. 'input', '${cwd}', '${result}') or literal primitives (e.g. 'npm test', 'write', 'system_health.md'). MUST be flat strings/numbers/booleans, NEVER wrapper objects!",
      ),
    outputKey: z
      .string()
      .optional()
      .describe("Descriptive memory key for plugin output (e.g. 'system_metrics', 'file_content', 'search_data'). Avoid 'result' unless this is the final deliverable node!"),
    edgeCondition: edgeConditionSchema.optional(),
    newStateProperties: z
      .record(z.string(), statePropertyDefinitionSchema)
      .optional()
      .describe("If outputKey is new, define its schema here"),
  });
}

function buildLlmConfigSchema(availablePlugins: PluginInfo[]) {
  const pluginNames = availablePlugins.map((p) => p.name);

  return z.object({
    nodeId: z
      .string()
      .describe("Unique lowercase alphanumeric ID for this new node"),
    nodeName: z
      .string()
      .describe(
        "Beautiful human readable name (e.g. 'Synthesize Findings', 'Validate Criteria')",
      ),
    plugins: z
      .array(z.string())
      .optional()
      .describe(
        `Tools/plugins this LLM can invoke autonomously. Available: [${pluginNames.join(", ")}]`,
      ),
    pluginId: z.string().optional().describe("Optional plugin ID if needed"),
    systemPrompt: z.string().describe("The prompt instructions for the LLM node"),
    outputKey: z
      .string()
      .optional()
      .describe("Descriptive memory key for this node's output (e.g. 'summary_report', 'analysis', 'extracted_data', 'quality_score'). Avoid 'result' unless this is the final deliverable node!"),
    edgeCondition: edgeConditionSchema.optional(),
    newStateProperties: z
      .record(z.string(), statePropertyDefinitionSchema)
      .optional()
      .describe("If outputKey is new, define its schema here"),
  });
}

/**
 * Dynamic Zod schema for configuring a Condition node.
 */
function buildConditionNodeSchema(availableStateKeys: string[]) {
  const validKeys = availableStateKeys.filter((k) => k && k.trim().length > 0);
  const fieldSchema =
    validKeys.length > 0
      ? z
          .enum(validKeys as [string, ...string[]])
          .describe(
            `The state memory variable to check. Must be one of: [${validKeys.join(", ")}]`,
          )
      : z
          .string()
          .describe(
            "The exact state memory variable to check (e.g. 'is_valid', 'is_approved', 'is_anomaly')",
          );

  return z.object({
    nodeId: z
      .string()
      .describe("Unique lowercase alphanumeric ID for this condition node"),
    nodeName: z
      .string()
      .describe("Human readable name (e.g. Is Anomaly Detected?)"),
    condition: z
      .object({
        field: fieldSchema,
        operator: z
          .enum([
            "equals",
            "not_equals",
            "greater_than",
            "greater_than_or_equals",
            "less_than",
            "less_than_or_equals",
            "contains",
            "not_contains",
            "starts_with",
            "ends_with",
            "is_empty",
            "is_not_empty",
            "in",
            "not_in",
            "regex_match",
          ])
          .describe("Comparison operator"),
        value: z
          .any()
          .describe(
            "The static value to compare against (e.g. true, false, 'approved', 7)",
          ),
      })
      .describe("The exact logic rule for the True path."),
  });
}

export type IncrementalEvent =
  | { type: "planning"; thoughts: string }
  | {
      type: "node_added";
      node: GraphNode;
      edge?: GraphEdge;
      stateProperties?: Record<string, any>;
    }
  | {
      type: "node_configuring";
      nodeId: string;
      nodeName: string;
    }
  | {
      type: "node_updated";
      node: GraphNode;
      stateProperties?: Record<string, any>;
    }
  | { type: "edge_added"; edge: GraphEdge };

/**
 * Zod schema for configuring the End node deliverable contract (Structured Output).
 */
const endNodeConfigSchema = z.object({
  thought: z
    .string()
    .describe("Explanation of the final deliverable and format of this workflow"),
  type: z
    .enum([
      "file",
      "markdown",
      "table",
      "chart",
      "json",
      "image",
      "html",
      "url",
      "terminal",
      "boolean",
      "text",
    ])
    .describe("The primary type of deliverable produced by this workflow"),
  summary: z
    .string()
    .describe("Concise human-readable summary of what this workflow delivers"),
  contentKey: z
    .string()
    .describe(
      "The exact state memory variable that holds the primary deliverable (e.g. 'generate_summary_output', 'analysis_result', etc.)",
    ),
  files: z
    .array(
      z.object({
        name: z.string().describe("Filename e.g. 'system_health.md'"),
        path: z.string().describe("File path on disk, matching the saved file name or path within workspace e.g. 'system_health.md'"),
        mimeType: z.string().optional().describe("MIME type e.g. 'text/markdown'"),
      }),
    )
    .optional()
    .describe("If type is 'file', the file(s) generated by the workflow"),
  requiresUserInput: z
    .boolean()
    .describe(
      "Whether this workflow requires a runtime input/query/ticket/message from the user when executed (e.g. true if it classifies, processes, or responds to user-provided text/query/ticket; false if it runs autonomously e.g. checking battery, bash diagnostics, timer, or predefined hardcoded tasks)",
    ),
  inputDescription: z
    .string()
    .optional()
    .describe(
      "If requiresUserInput is true, a concise, human-friendly label for the input modal (e.g. 'Technical support ticket to classify', 'Text to translate', 'Search query')",
    ),
});

export async function* generateIncrementalGraph(
  prompt: string,
  modelName: string,
  availablePlugins: PluginInfo[],
  currentGraph?: LangGraphAbstraction,
  _targetNodeId?: string,
): AsyncGenerator<IncrementalEvent, LangGraphAbstraction, unknown> {
  const pluginNames = new Set(availablePlugins.map((p) => p.name));

  // Dynamic schema for Phase 1
  const workflowSkeletonSchema = buildWorkflowSkeletonSchema(availablePlugins);
  const architectLlm = new ChatOllama({
    model: modelName,
    temperature: 0.1,
  }).withStructuredOutput(workflowSkeletonSchema, {
    name: "WorkflowArchitect",
  });

  const criticLlm = new ChatOllama({
    model: modelName,
    temperature: 0.05,
  }).withStructuredOutput(workflowSkeletonSchema, {
    name: "ArchitectureCritic",
  });

  const configLlm = new ChatOllama({ model: modelName, temperature: 0.05 });
  const pluginConfigSchema = buildPluginConfigSchema(availablePlugins);
  const pluginAgent = configLlm.withStructuredOutput(pluginConfigSchema, {
    name: "PluginConfig",
  });
  const dynamicLlmConfigSchema = buildLlmConfigSchema(availablePlugins);
  const llmAgent = configLlm.withStructuredOutput(dynamicLlmConfigSchema, {
    name: "LLMConfig",
  });
  const endAgent = configLlm.withStructuredOutput(endNodeConfigSchema, {
    name: "DeliverableConfig",
  });

  const graph: LangGraphAbstraction = currentGraph
    ? JSON.parse(JSON.stringify(currentGraph))
    : {
        nodes: [],
        edges: [],
        stateSchema: {
          input: {
            type: "string",
            description: "User initial query or prompt for this execution",
            required: false,
          },
          cwd: {
            type: "string",
            description: "Current working directory / workspace path",
            required: false,
          },
          os: {
            type: "string",
            description: "Host operating system platform (e.g. linux, darwin, windows)",
            required: false,
          },
          result: {
            type: "unknown",
            description:
              "Final outcome or primary deliverable produced by this workflow",
            required: false,
          },
        },
      };

  console.log(
    `\n[Visual Builder - Generator] === Starting Two-Phase Graph Generation ===`,
  );
  console.log(`[Visual Builder - Generator] Model: "${modelName}"`);
  console.log(`[Visual Builder - Generator] User Objective: "${prompt}"`);
  console.log(
    `[Visual Builder - Generator] Available plugins (${availablePlugins.length}): [${availablePlugins.map((p) => p.name).join(", ")}]`,
  );

  // ==========================================
  // PHASE 1: TOPOLOGY ARCHITECT (Options 1 & 4)
  // ==========================================
  yield {
    type: "planning",
    thoughts: "Designing the complete workflow architecture...",
  };

  const architectPrompt = `You are the Lead Workflow Architect for an AI Agent Visual Builder.
Given the User's Objective and available plugins, design the COMPLETE topology of the workflow (all nodes and edges) in ONE cohesive architecture.

Host Operating System: "${Deno.build.os}". Ensure any tool or shell steps are designed for this operating system.

Available Plugins and their parameter schemas:
${availablePlugins
  .map(
    (p) =>
      `- ${p.name}: ${p.description}\n  Parameters: ${p.parametersDescription || "none"}${p.returnDescription ? `\n  Returns: ${p.returnDescription}` : ""}`,
  )
  .join("\n")}

CRITICAL ARCHITECTURE RULES & NODE ARCHETYPES:
1. Built-in Entry & Exit Terminals:
   - "start" and "end" ALREADY exist as the system's entry and exit nodes!
   - DO NOT create any node named "start", "Start", "end", or "End"!
   - The first functional processing step connects FROM "start".
   - The final functional step(s) connect TO "end".
   - If the workflow begins with a fixed pre-defined action (e.g. running a specific shell diagnostic command, reading a known file, getting current datetime), "start" CAN connect to a "plugin" node with pre-configured parameters.
   - If the workflow begins with an open-ended request or needs to understand dynamic user intent, "start" MUST connect to an "llm" node.

2. Node Archetypes & Purpose:
   - ARCHETYPE "plugin" (Single Atomic Tool Execution):
     * Use ONLY when a step executes exactly ONE tool call with fully pre-determined, static parameters.
     * The tool, the operation, and all its parameters must be completely known before execution — no decisions, no branching, no adaptation.
     * NEVER use plugin when the step involves more than one tool call, requires evaluating intermediate results, or needs to adapt its next action based on what a tool returned.
     * NEVER chain two raw plugins directly together if semantic translation, filtering, or decision-making is needed between them; insert an LLM node.

   - ARCHETYPE "llm" (Pure Cognitive Reasoning — NO external tools):
     * Consumes data already present in the state, reasons, and produces new data.
     * Use for analyzing, transforming, synthesizing, evaluating, scoring, or drafting content from the state.
     * Does NOT invoke any external tool. Only thinks and writes to state.
     * If evaluating before a condition, set outputKey to a score (number), category (string), or approval flag (boolean).

   - ARCHETYPE "agent" (Autonomous Multi-Tool Agent):
     * An agent equipped with tools that operates in a dynamic observe → act → evaluate → act loop.
     * Use when a step involves multiple related tool actions where the result of one action determines what to do next.
     * Use when splitting the step into separate nodes would be unnatural or brittle because the internal decision logic is too dynamic to script statically.
     * Use when the agent needs to retry, refine, or cross-reference across multiple tool outputs before producing a final result.
     * Do NOT use an agent for a single, fully pre-determined tool call — use a plugin node instead.

   - ARCHETYPE "condition" (Control Flow Logic Router):
     * If/else decision diamond evaluating a typed state variable (boolean, number, string).
     * Must have exactly two outgoing edges (path="true" and path="false").

3. Condition Node Patterns (MANDATORY: EXACTLY TWO outgoing edges, path="true" and path="false"):
   - PATTERN A: Branching Router (Forking paths)
     When an objective says "if X do this, otherwise do that":
     * Edge 1: source: "check_anomalies", target: "end", path: "false" (when normal)
     * Edge 2: source: "check_anomalies", target: "write_alert_log", path: "true" (when anomaly detected)
   - PATTERN B: Iterative Refinement Loop (Retry on failure)
     When an objective says "if not approved/insufficient, repeat/refine":
     * Edge 1: source: "evaluate_quality", target: "finalize_report", path: "true"
     * Edge 2: source: "evaluate_quality", target: "research_agent", path: "false" (loops back)

4. Ensure every branch eventually reaches "end". Design between 2 and 5 real functional nodes matching all requirements of the user's objective.`;

  let skeleton: z.infer<typeof workflowSkeletonSchema>;
  try {
    skeleton = (await architectLlm.invoke([
      new SystemMessage(architectPrompt),
      new HumanMessage(`User Objective: "${prompt}"`),
    ])) as z.infer<typeof workflowSkeletonSchema>;
    console.log(
      `[Visual Builder - Generator] Architecture designed: ${skeleton.nodes.length} nodes, ${skeleton.edges.length} edges`,
    );
  } catch (err: any) {
    console.warn(
      `[Visual Builder - Generator] Architect LLM structured output error, using context-aware heuristic fallback:`,
      err?.message,
    );
    skeleton = buildHeuristicSkeleton(prompt, availablePlugins);
  }

  // ==========================================
  // PHASE 1.5: ARCHITECTURE CRITIC & VALIDATOR
  // ==========================================
  yield {
    type: "planning",
    thoughts: "Validating and optimizing workflow node roles and architecture...",
  };

  const criticPrompt = `You are the Senior Workflow Architecture Critic & Validator for an AI Agent Visual Builder.
Review the DRAFT workflow proposed by the Architect for the User's Objective:
"${prompt}"

Host Operating System: "${Deno.build.os}".

Available Plugins and their Capabilities:
${availablePlugins
  .map(
    (p) =>
      `- "${p.name}": ${p.description}\n  Parameters: ${p.parametersDescription || "none"}`,
  )
  .join("\n")}

Draft Nodes proposed:
${skeleton.nodes.map((n) => `- [${n.type}] "${n.name}" (ID: "${n.id}", pluginId: "${n.pluginId || "none"}", tools: [${(n.plugins || []).join(", ")}]): ${n.description}`).join("\n")}

Draft Edges proposed:
${skeleton.edges.map((e) => `- ${e.source} -> ${e.target} ${e.path ? `(${e.path})` : ""}`).join("\n")}

CRITICAL ARCHITECTURE AUDIT RULES:
1. Plugin Identity & Tool Mapping:
   - Plugins MUST be strictly chosen from the registered available plugins: [${Array.from(pluginNames).join(", ")}].
   - Match each plugin node strictly to the available plugin whose description and capability best corresponds to the user's objective and node description.
   - If the Architect proposed an invented plugin name, map it to the registered available plugin that provides that capability.
   - Any cognitive reasoning, analyzing, drafting, or summarizing step MUST be type: "llm", NEVER type: "plugin"!

2. Node Type Correctness:
   - "plugin": Use ONLY for exactly ONE tool call with fully pre-determined, static parameters. If the step needs more than one tool call, or if intermediate results influence what to do next, it is NOT a plugin.
   - "llm": Pure reasoning — consumes state, produces state. NO tool invocation whatsoever.
   - "agent": Use when a step involves multiple related tool actions where the agent must evaluate intermediate results to decide next actions, when splitting into separate nodes would be unnatural or brittle, or when the agent needs to retry, refine, or cross-reference across tool outputs dynamically.
   - NEVER classify a step as "llm" if it needs to actively call external tools to complete its goal — use "agent" instead.
   - NEVER use an "agent" for a single, fully pre-determined tool call — use "plugin" instead.

3. Edge & ID Integrity:
   - Ensure clean, descriptive IDs (e.g. 'execute_check', 'summarize_report', 'save_output_file').
   - Start connects to the first functional node; the final functional node connects to End.
   - Condition nodes must have both 'true' and 'false' paths.

Return the refined, perfected workflow skeleton.`;

  try {
    const validated = (await criticLlm.invoke([
      new SystemMessage(criticPrompt),
      new HumanMessage("Validate and refine the workflow skeleton."),
    ])) as z.infer<typeof workflowSkeletonSchema>;

    if (validated && validated.nodes && validated.nodes.length > 0) {
      console.log(
        `[Visual Builder - Generator] Critic validated architecture: ${validated.nodes.length} nodes, ${validated.edges.length} edges`,
      );
      skeleton = validated;
    }
  } catch (err: any) {
    console.warn(
      `[Visual Builder - Generator] Critic LLM pass error, keeping architect draft:`,
      err?.message,
    );
  }

  yield {
    type: "planning",
    thoughts: skeleton.thought,
  };

  // 1. Deterministically inject native Start node via code
  const startNode: GraphNode = {
    id: "start",
    name: "Start",
    type: "start",
    config: {},
  };
  graph.nodes.push(startNode);
  yield {
    type: "node_added",
    node: startNode,
  };

  // 2. Deterministically filter out any dummy "start" or "end" nodes
  const bypassMap = new Map<string, string>(); // dummyNodeId -> realTarget
  const skeletonNodesToKeep: typeof skeleton.nodes = [];

  for (const n of skeleton.nodes) {
    const lowerId = n.id.toLowerCase().trim();
    const lowerName = n.name.toLowerCase().trim();
    const isStartAlias =
      lowerId === "start" ||
      lowerId === "start_step" ||
      lowerId === "start_node" ||
      lowerName === "start";
    const isEndAlias =
      lowerId === "end" ||
      lowerId === "end_step" ||
      lowerId === "end_node" ||
      lowerName === "end";

    if (isStartAlias) {
      const outgoing = skeleton.edges.find((e) => e.source === n.id);
      if (outgoing) {
        bypassMap.set(n.id, outgoing.target);
      }
    } else if (isEndAlias) {
      bypassMap.set(n.id, "end");
    } else {
      skeletonNodesToKeep.push(n);
    }
  }

  // Build & Clean Intermediate Nodes
  const idMap = new Map<string, string>();
  idMap.set("start", "start");
  idMap.set("end", "end");

  const intermediateNodes: GraphNode[] = [];
  const nodeDescriptions = new Map<string, string>();
  for (const n of skeletonNodesToKeep) {
    let cleanId = n.id.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (
      cleanId === "start" ||
      cleanId === "end" ||
      graph.nodes.some((x) => x.id === cleanId) ||
      intermediateNodes.some((x) => x.id === cleanId)
    ) {
      cleanId = `${cleanId}_step`;
    }
    idMap.set(n.id, cleanId);
    nodeDescriptions.set(cleanId, n.description);

    let nodeType = n.type;
    let cleanPluginId = normalizePluginName(n.pluginId, availablePlugins);

    // INVARIANT: An LLM node is NEVER a plugin!
    // If a node was marked as 'plugin' but refers to LLM/reasoning or an unknown non-plugin, reclassify as 'llm'!
    if (
      nodeType === "plugin" &&
      (!cleanPluginId || !pluginNames.has(cleanPluginId)) &&
      (/llm|reason|summar|analyz|draft|generat/i.test(cleanId) ||
       /llm|reason|summar|analyz|draft|generat/i.test(n.name) ||
       /llm/i.test(n.pluginId || "") ||
       /llm|reason|summar|analyz|draft|generat/i.test(n.description || ""))
    ) {
      nodeType = "llm";
      cleanPluginId = undefined;
    }

    if (nodeType === "plugin") {
      if (!cleanPluginId || !pluginNames.has(cleanPluginId)) {
        // Dynamically find the best matching available plugin using description keyword scoring
        const nodeText = `${cleanId} ${n.name} ${n.description || ""} ${prompt}`.toLowerCase();
        let bestMatch: PluginInfo | undefined;
        let highestScore = -1;

        for (const p of availablePlugins) {
          let score = 0;
          const pNameNorm = p.name.toLowerCase().replace(/[-_]/g, "");
          if (nodeText.includes(pNameNorm) || nodeText.includes(p.name.toLowerCase())) {
            score += 10;
          }
          // Score by words in the plugin's own description and parameter names
          const keywords = `${p.name} ${p.description} ${p.parametersDescription || ""}`
            .toLowerCase()
            .split(/[^a-z0-9_]+/)
            .filter((w) => w.length > 3 && !["this", "with", "from", "that", "tool", "plugin", "node", "when"].includes(w));

          for (const kw of keywords) {
            if (nodeText.includes(kw)) {
              score += 1;
            }
          }

          if (score > highestScore) {
            highestScore = score;
            bestMatch = p;
          }
        }

        cleanPluginId = bestMatch?.name || availablePlugins[0]?.name;
      }
    }

    let cleanPlugins = ((n as any).plugins as string[] | undefined)
      ?.map((p) => normalizePluginName(p, availablePlugins))
      .filter((p): p is string => Boolean(p && pluginNames.has(p)));

    const node: GraphNode = {
      id: cleanId,
      name: n.name,
      type: nodeType,
      config:
        nodeType === "plugin"
          ? { pluginId: cleanPluginId }
          : nodeType === "agent" && cleanPlugins && cleanPlugins.length > 0
            ? { plugins: cleanPlugins }
            : nodeType === "llm" && cleanPlugins && cleanPlugins.length > 0
              ? { plugins: cleanPlugins }
              : {},
    };
    intermediateNodes.push(node);
    graph.nodes.push(node);
  }

  // 3. Deterministically inject native End node via code
  const endNode: GraphNode = {
    id: "end",
    name: "End",
    type: "end",
    config: {},
  };
  graph.nodes.push(endNode);

  // Map and Sanitize Edges
  const validNodeIds = new Set(graph.nodes.map((n) => n.id));
  const rawEdges: GraphEdge[] = [];

  for (const raw of skeleton.edges) {
    let s = idMap.get(raw.source) || raw.source;
    let t = idMap.get(raw.target) || raw.target;

    if (bypassMap.has(raw.source)) {
      continue;
    }
    if (bypassMap.has(raw.target)) {
      const realTarget = bypassMap.get(raw.target)!;
      t = idMap.get(realTarget) || realTarget;
    }
    // Forbid self-loops on a node
    if (s === t) continue;
    if (!validNodeIds.has(s) || !validNodeIds.has(t)) continue;

    const sourceNode = graph.nodes.find((n) => n.id === s);
    const isCondition = sourceNode?.type === "condition";

    let cleanPath: "true" | "false" | undefined = undefined;
    if (isCondition) {
      const pRaw = (raw.path || "").toLowerCase().trim();
      const sIdx = intermediateNodes.findIndex((n) => n.id === s);
      const tIdx = intermediateNodes.findIndex((n) => n.id === t);
      const isLoopback = tIdx !== -1 && sIdx !== -1 && tIdx < sIdx;

      if (
        pRaw === "false" ||
        pRaw === "no" ||
        pRaw === "fail" ||
        pRaw === "retry" ||
        pRaw === "loop" ||
        pRaw === "loopback" ||
        isLoopback
      ) {
        cleanPath = "false";
      } else {
        cleanPath = "true";
      }
    }

    rawEdges.push({
      id: `edge_${s}_${t}${cleanPath ? `_${cleanPath}` : ""}`,
      source: s,
      target: t,
      isConditional: isCondition,
      path: cleanPath,
    });
  }

  // ==============================================================
  // DETERMINISTIC GRAPH INTEGRITY & CONNECTIVITY GUARANTEES (BY CODE)
  // ==============================================================
  // 1. Invariant: Start must have at least one outgoing edge
  if (!rawEdges.some((e) => e.source === "start") && intermediateNodes.length > 0) {
    rawEdges.unshift({
      id: `edge_start_${intermediateNodes[0].id}`,
      source: "start",
      target: intermediateNodes[0].id,
      isConditional: false,
    });
  }

  // 2. Invariant: Every intermediate node must have at least one incoming edge (No orphan nodes)
  for (let i = 0; i < intermediateNodes.length; i++) {
    const node = intermediateNodes[i];
    const hasIncoming = rawEdges.some((e) => e.target === node.id);
    if (!hasIncoming) {
      const prevId = i === 0 ? "start" : intermediateNodes[i - 1].id;
      console.log(
        `[Visual Builder - Generator] Deterministic code: Auto-connecting orphan node "${node.id}" from "${prevId}"`,
      );
      rawEdges.push({
        id: `edge_${prevId}_${node.id}`,
        source: prevId,
        target: node.id,
        isConditional: false,
      });
    }
  }

  // 3. Invariant: Every intermediate node must have at least one outgoing edge (No dead-ends)
  for (let i = 0; i < intermediateNodes.length; i++) {
    const node = intermediateNodes[i];
    const hasOutgoing = rawEdges.some((e) => e.source === node.id);
    if (!hasOutgoing) {
      const nextId =
        i < intermediateNodes.length - 1
          ? intermediateNodes[i + 1].id
          : "end";
      console.log(
        `[Visual Builder - Generator] Deterministic code: Auto-connecting dead-end node "${node.id}" to "${nextId}"`,
      );
      rawEdges.push({
        id: `edge_${node.id}_${nextId}`,
        source: node.id,
        target: nextId,
        isConditional: node.type === "condition",
        path: node.type === "condition" ? "true" : undefined,
      });
    }
  }

  // 4. Invariant: Condition Nodes must have EXACTLY ONE "true" and EXACTLY ONE "false" path
  for (const cn of intermediateNodes.filter((n) => n.type === "condition")) {
    const cnIndex = intermediateNodes.findIndex((n) => n.id === cn.id);

    // Any edge pointing backwards to an earlier node is inherently a loopback/retry branch
    for (const e of rawEdges.filter((edge) => edge.source === cn.id)) {
      const targetIndex = intermediateNodes.findIndex((n) => n.id === e.target);
      if (targetIndex !== -1 && targetIndex < cnIndex) {
        e.path = "false";
        e.isConditional = true;
      }
    }

    let fromCn = rawEdges.filter((e) => e.source === cn.id);
    let trueEdges = fromCn.filter((e) => e.path === "true");
    let falseEdges = fromCn.filter((e) => e.path === "false");

    // If multiple true edges exist and no false edge, convert backward/alternative edge to false
    if (trueEdges.length > 1 && falseEdges.length === 0) {
      const backward = trueEdges.find((e) => {
        const targetIndex = intermediateNodes.findIndex((n) => n.id === e.target);
        return targetIndex !== -1 && targetIndex < cnIndex;
      });
      if (backward) {
        backward.path = "false";
      } else {
        trueEdges[1].path = "false";
      }
      fromCn = rawEdges.filter((e) => e.source === cn.id);
      trueEdges = fromCn.filter((e) => e.path === "true");
      falseEdges = fromCn.filter((e) => e.path === "false");
    }

    // Strictly enforce at most ONE true edge
    if (trueEdges.length > 1) {
      for (const rem of trueEdges.slice(1)) {
        const idx = rawEdges.indexOf(rem);
        if (idx !== -1) rawEdges.splice(idx, 1);
      }
    }

    // Strictly enforce at most ONE false edge
    if (falseEdges.length > 1) {
      for (const rem of falseEdges.slice(1)) {
        const idx = rawEdges.indexOf(rem);
        if (idx !== -1) rawEdges.splice(idx, 1);
      }
    }

    // If missing true branch, add exactly one forward
    if (!rawEdges.some((e) => e.source === cn.id && e.path === "true")) {
      const unlinked = intermediateNodes.find(
        (n, idx) => n.id !== cn.id && idx > cnIndex && !rawEdges.some((e) => e.target === n.id),
      );
      const target = unlinked ? unlinked.id : "end";
      rawEdges.push({
        id: `edge_${cn.id}_${target}_true`,
        source: cn.id,
        target,
        isConditional: true,
        path: "true",
      });
    }

    // If missing false branch, add exactly one backward or alternative
    if (!rawEdges.some((e) => e.source === cn.id && e.path === "false")) {
      const loopTarget = intermediateNodes.find(
        (n, idx) => n.id !== cn.id && n.type !== "condition" && idx < cnIndex,
      );
      const target = loopTarget ? loopTarget.id : "end";
      rawEdges.push({
        id: `edge_${cn.id}_${target}_false`,
        source: cn.id,
        target,
        isConditional: true,
        path: "false",
      });
    }
  }

  // 5. Invariant: Loop Termination & Reachability to "end" (Prevent infinite loops)
  // Ensure every node has an executable path to "end"
  const canReachEnd = (startNodeId: string, visited = new Set<string>()): boolean => {
    if (startNodeId === "end") return true;
    if (visited.has(startNodeId)) return false; // Cycle detected along this path
    visited.add(startNodeId);
    const outgoing = rawEdges.filter((e) => e.source === startNodeId);
    return outgoing.some((e) => canReachEnd(e.target, new Set(visited)));
  };

  for (const node of intermediateNodes) {
    if (!canReachEnd(node.id)) {
      console.log(
        `[Visual Builder - Generator] Deterministic code: Node "${node.id}" cannot reach "end" (cycle or dead path detected). Adding termination edge to "end".`,
      );
      rawEdges.push({
        id: `edge_${node.id}_end_exit`,
        source: node.id,
        target: "end",
        isConditional: node.type === "condition",
        path: node.type === "condition" ? "true" : undefined,
      });
    }
  }

  // 6. Invariant: Deduplicate edges
  const seenEdges = new Set<string>();
  const sanitizedEdges: GraphEdge[] = [];
  for (const e of rawEdges) {
    const key = `${e.source}->${e.target}:${e.path || ""}`;
    if (!seenEdges.has(key)) {
      seenEdges.add(key);
      sanitizedEdges.push(e);
    }
  }

  graph.edges = sanitizedEdges;

  // Stream Phase 1 nodes and primary incoming edges
  const emittedEdges = new Set<string>();
  for (const node of intermediateNodes) {
    const primaryEdge = graph.edges.find(
      (e) => e.target === node.id && !emittedEdges.has(e.id),
    );
    if (primaryEdge) emittedEdges.add(primaryEdge.id);

    yield {
      type: "node_added",
      node,
      edge: primaryEdge,
    };
  }

  // Stream remaining edges
  for (const edge of graph.edges) {
    if (!emittedEdges.has(edge.id)) {
      emittedEdges.add(edge.id);
      yield {
        type: "edge_added",
        edge,
      };
    }
  }

  yield {
    type: "node_added",
    node: endNode,
  };

  // ==========================================
  // PHASE 2: DETAILED NODE CONFIGURATION (Options 2 & 3)
  // ==========================================
  console.log(`[Visual Builder - Generator] === Phase 2: Configuring Nodes ===`);

  for (const node of intermediateNodes) {
    console.log(
      `[Visual Builder - Generator] Configuring node [${node.type}] "${node.name}" (${node.id})...`,
    );

    yield {
      type: "node_configuring",
      nodeId: node.id,
      nodeName: node.name,
    };

    const graphStateText = `Current Memory Variables (State):
${
  Object.keys(graph.stateSchema).length > 0
    ? Object.entries(graph.stateSchema)
        .map(([k, v]) => `  - ${k} (${(v as any).type})`)
        .join("\n")
    : "  - input (string)"
}`;

    if (node.type === "llm") {
      // Check if this LLM feeds directly into a condition node
      const feedsIntoCondition = graph.edges.some(
        (e) =>
          e.source === node.id &&
          graph.nodes.find((n) => n.id === e.target)?.type === "condition",
      );

      const nodePlugins = (node.config.plugins as string[]) || [];
      const agentToolHint =
        nodePlugins.length > 0
          ? `\nNOTE: This LLM node is an autonomous agent equipped with tools: [${nodePlugins.join(", ")}].
Instruct it in systemPrompt to use its tools iteratively (e.g. searching the web, reading multiple relevant URLs, extracting details, saving files) to compile a rich, thorough response before concluding.`
          : "";

      const conditionPromptHint = feedsIntoCondition
        ? `\nCRITICAL: This LLM node feeds directly into a condition/decision node.
Choose the appropriate output type based on the user objective:
- If a numeric score, threshold, rating, or count is requested (e.g. score >= 7, rating > 80, count < 5): name 'outputKey' accordingly (e.g. 'score', 'rating', 'metric') and define it as 'number' in newStateProperties. Instruct the model to return ONLY the numeric score.
- If a category or status is requested (e.g. category equals 'security'): name 'outputKey' (e.g. 'category', 'status') and define it as 'string'.
- If a direct yes/no decision is requested: name 'outputKey' with an 'is_' prefix (e.g. 'is_approved', 'is_valid', 'is_critical') and define it as 'boolean'.`
        : "";

      const nodeRole = nodeDescriptions.get(node.id) || node.name;
      const incomingEdge = graph.edges.find((e) => e.target === node.id);
      const branchHint = incomingEdge?.path
        ? `\nWorkflow Path Context: This node executes on the '${incomingEdge.path}' branch from '${incomingEdge.source}'.`
        : "";

      const builderMessages = [
        new SystemMessage(`You are an LLM Node Configurator in an AI Workflow Visual Builder.
Node Name: "${node.name}" (ID: "${node.id}")
Specific Node Operational Role / Mission: "${nodeRole}"
${branchHint}
${agentToolHint}
${conditionPromptHint}
${graphStateText}

CRITICAL INSTRUCTIONS:
1. Configure the systemPrompt and memory outputKey SPECIFICALLY for THIS node's assigned mission: "${nodeRole}".
2. ${
  feedsIntoCondition
    ? "This node evaluates a condition. Set outputKey to a decision metric (e.g. 'is_...' for boolean, 'score' for number)."
    : "This node does NOT evaluate a condition. It transforms, summarizes, generates, or drafts content. Its outputKey MUST NOT be a boolean decision flag like 'is_...' and MUST NOT overwrite previous decision variables in the State."
}
3. Read the Overall User Objective to understand the context, but fulfill ONLY this specific node's assigned mission ("${nodeRole}")!`),
        new HumanMessage(
          `Overall User Objective: "${prompt}"\n\nConfigure THIS node ("${node.name}", mission: "${nodeRole}").`,
        ),
      ];

      try {
        const config = (await llmAgent.invoke(builderMessages)) as z.infer<
          ReturnType<typeof buildLlmConfigSchema>
        >;
        let outKey = config.outputKey || `${node.id}_output`;
        const isLastIntermediate =
          intermediateNodes[intermediateNodes.length - 1]?.id === node.id;
        if (outKey === "result" && !isLastIntermediate) {
          outKey = `${node.id}_output`;
        }

        const requestedType =
          config.newStateProperties?.[outKey]?.type ||
          (/score|count|rating|level|number|metric|percentage/i.test(outKey)
            ? "number"
            : /category|classification|sentiment|status/i.test(outKey)
              ? "string"
              : outKey.startsWith("is_") || outKey.endsWith("_valid") || outKey.endsWith("_approved") || outKey.endsWith("_flag")
                ? "boolean"
                : "string");

        const isNumeric = requestedType === "number";
        const isBooleanField = requestedType === "boolean";

        if (feedsIntoCondition && isBooleanField && !outKey.startsWith("is_")) {
          outKey = `is_${outKey.replace(/[^a-z0-9_]/g, "_")}`;
        } else if (!feedsIntoCondition) {
          // If this LLM node does NOT feed into a condition, it MUST NOT output a boolean flag or overwrite existing decision keys!
          if (outKey.startsWith("is_") || (graph.stateSchema[outKey] && graph.stateSchema[outKey].type === "boolean")) {
            outKey = `${node.id}_output`;
          }
        }

        let promptText = config.systemPrompt;
        if (!feedsIntoCondition && /return (?:only )?(?:true|false|boolean)/i.test(promptText)) {
          promptText = `You are a helpful AI assistant. Your mission is: ${nodeRole}.\nRead the input and relevant context from memory, and fulfill the requested task with a thorough, well-crafted response.`;
        }

        // Check if there are other plugin nodes in the graph that already execute tools
        const hasExternalPluginNodes = intermediateNodes.some((n) => n.type === "plugin");
        const isCodingOrDraftingNode = /write|generat|draft|summariz|classif|translat|cod/i.test(node.id) || /write|generat|draft|summariz|classif|translat|cod/i.test(nodeRole);

        const rawPluginsList =
          config.plugins && config.plugins.length > 0
            ? config.plugins
            : nodePlugins;

        const deduplicatedPlugins = Array.from(
          new Set(
            rawPluginsList
              .map((p) => normalizePluginName(p, availablePlugins))
              .filter((p): p is string => Boolean(p && pluginNames.has(p))),
          ),
        );

        // If the graph already has dedicated plugin nodes and this LLM node's
        // role is purely to write/generate code or text, it does NOT need external tools bound!
        const finalPlugins =
          hasExternalPluginNodes && isCodingOrDraftingNode
            ? undefined
            : deduplicatedPlugins.length > 0
              ? deduplicatedPlugins
              : undefined;

        node.config = {
          model: modelName,
          temperature: 0.1,
          systemPrompt: feedsIntoCondition
            ? isNumeric
              ? `${config.systemPrompt}\nOutput only the numerical score/number without additional text.`
              : isBooleanField
                ? `${config.systemPrompt}\nEvaluate the input carefully. Return a boolean: true if the condition is satisfied, false otherwise.`
                : config.systemPrompt
            : promptText,
          outputKey: outKey,
          ...(finalPlugins ? { plugins: finalPlugins } : {}),
          ...(feedsIntoCondition && isBooleanField
            ? { structuredOutput: { type: "boolean", required: true } }
            : feedsIntoCondition && isNumeric
              ? { structuredOutput: { type: "number", required: true } }
              : {}),
        };

        if (feedsIntoCondition) {
          graph.stateSchema[outKey] = {
            type: isNumeric ? "number" : isBooleanField ? "boolean" : "string",
            description: `Decision metric for ${node.name}`,
            required: false,
          };
        } else if (config.newStateProperties) {
          Object.assign(graph.stateSchema, config.newStateProperties);
        } else if (!graph.stateSchema[outKey]) {
          graph.stateSchema[outKey] = {
            type: isNumeric ? "number" : isBooleanField ? "boolean" : "string",
            description: `Output of ${node.name}`,
            required: false,
          };
        }

        yield {
          type: "node_updated",
          node,
          stateProperties: graph.stateSchema,
        };
      } catch (err: any) {
        console.warn(
          `[Visual Builder - Generator] LLM Config failed for ${node.id}:`,
          err?.message,
        );
        const finalPlugins = nodePlugins.length > 0 ? nodePlugins : undefined;
        const outKey = feedsIntoCondition
          ? `${node.id}_is_approved`
          : `${node.id}_result`;
        node.config = {
          model: modelName,
          temperature: 0.1,
          systemPrompt: feedsIntoCondition
            ? `Evaluate if the input meets the required criteria. Return true if approved/satisfied, or false otherwise.`
            : finalPlugins
              ? `You are an autonomous agent. Use your tools [${finalPlugins.join(", ")}] to accomplish the task: ${prompt}`
              : `Analyze and process the input for the task: ${prompt}`,
          outputKey: outKey,
          ...(finalPlugins ? { plugins: finalPlugins } : {}),
          ...(feedsIntoCondition
            ? { structuredOutput: { type: "boolean", required: true } }
            : {}),
        };
        graph.stateSchema[outKey] = {
          type: feedsIntoCondition ? "boolean" : "string",
          description: `Output of ${node.name}`,
          required: false,
        };
        yield {
          type: "node_updated",
          node,
          stateProperties: graph.stateSchema,
        };
      }
    } else if (node.type === "plugin") {
      let selectedPluginId = (node.config.pluginId as string);
      if (!selectedPluginId || !pluginNames.has(selectedPluginId)) {
        selectedPluginId = availablePlugins[0]?.name || "tool";
      }
      const pluginDef = availablePlugins.find((p) => p.name === selectedPluginId) || availablePlugins[0];

      const nodeRole = nodeDescriptions.get(node.id) || node.name;
      const builderMessages = [
        new SystemMessage(`You are a Plugin Node Configurator.
Node Name: "${node.name}" (ID: "${node.id}")
Node Operational Role / Purpose: "${nodeRole}"

Available Plugins in the system and their parameter schemas:
${availablePlugins
  .map(
    (p) =>
      `- "${p.name}": ${p.description}\n  Parameters: ${p.parametersDescription || "None"}${p.returnDescription ? `\n  Returns: ${p.returnDescription}` : ""}`,
  )
  .join("\n\n")}

Selected Plugin for this node: "${pluginDef.name}"
Plugin Description: ${pluginDef.description || ""}
Plugin Required & Optional Parameters:
${pluginDef.parametersDescription || "None"}${pluginDef.returnDescription ? `\nPlugin Output / Returns: ${pluginDef.returnDescription}` : ""}

SYSTEM INVARIANTS:
- Select and confirm "pluginId" from the available plugins [${Array.from(pluginNames).join(", ")}] that best performs this node's role: "${nodeRole}".
- NEVER invent or hallucinate external tool names (like n8n, zapier, etc.)!

HOST SYSTEM ENVIRONMENT:
- Host Operating System: "${Deno.build.os}".
- For command or script execution tools: You MUST generate commands fully compatible with ${Deno.build.os}!
${
  Deno.build.os === "linux"
    ? `  * Linux detected: Use standard Linux CLI utilities. NEVER use macOS-only commands like 'pmset', 'top -l 1', or 'vm_stat'!`
    : Deno.build.os === "darwin"
      ? `  * macOS detected: Use macOS CLI utilities.`
      : `  * Windows detected: Use Windows CLI utilities.`
}

CRITICAL RULES FOR inputMapping:
1. You MUST provide values for all REQUIRED parameters of this plugin.
2. All values in inputMapping MUST be flat primitive strings, numbers, or booleans.
   - For literal values: provide the raw string directly (e.g. command: "git status --short", operation: "write", path: "system_health.md").
   - For state memory references: use variable names directly or with template syntax (e.g. "input", "cwd", "\${result}", "\${cwd}").
   - NEVER wrap values in objects like { staticValue: ... } or { value: ... }!
3. Matching Specific Commands to Specialized Nodes:
   - When the user objective specifies multiple commands (e.g. chained with '&&', ';', or 'and') and the workflow decomposed them into separate specialized nodes (e.g. one node for "Git Status" and one for "Git Log"):
     Assign ONLY the specific sub-command matching THIS node's Operational Role!
     * For a Status inspection node: use ONLY the status command (e.g. "git status --short").
     * For a Log/history inspection node: use ONLY the log command (e.g. "git log -n 3 --oneline").
     * DO NOT copy the entire chained string into both nodes!
   - If there is only ONE plugin node in the workflow for multiple commands, then assign the full chained command.
${graphStateText}`),
        new HumanMessage(
          `Overall User Objective: "${prompt}"\nConfigure this plugin node specifically for its role: "${nodeRole}".`,
        ),
      ];

      try {
        const config = (await pluginAgent.invoke(builderMessages)) as z.infer<
          ReturnType<typeof buildPluginConfigSchema>
        >;
        let outKey = config.outputKey || `${node.id}_data`;
        const isLastIntermediate =
          intermediateNodes[intermediateNodes.length - 1]?.id === node.id;
        if (outKey === "result" && !isLastIntermediate) {
          outKey = `${node.id}_data`;
        }

        let effectivePluginId = selectedPluginId;
        if (config.pluginId) {
          const normalized = normalizePluginName(config.pluginId, availablePlugins);
          if (normalized && pluginNames.has(normalized)) {
            effectivePluginId = normalized;
          }
        }
        if (!pluginNames.has(effectivePluginId)) {
          effectivePluginId = availablePlugins[0]?.name || "tool";
        }

        const rawMapping = (config.inputMapping || {}) as Record<string, any>;
        const inputMapping: Record<string, any> = {};
        for (const [k, v] of Object.entries(rawMapping)) {
          if (v && typeof v === "object" && "value" in v) {
            inputMapping[k] = (v as any).value;
          } else {
            inputMapping[k] = v;
          }
        }

        // === SCHEMA-DRIVEN GENERIC PARAMETER AUTO-COMPLETION ===
        const expectedKeys = new Set([
          ...(pluginDef.parameterKeys || []),
          ...Object.keys(rawMapping),
        ]);
        const hasParam = (pattern: RegExp) =>
          Array.from(expectedKeys).find((k) => pattern.test(k));

        // 1. Path / File parameter (e.g. path, file, filename, filePath)
        const pathKey = hasParam(/^(?:path|file|filename|filePath)$/i);
        if (pathKey) {
          if (!inputMapping[pathKey]) {
            const fileMatch = prompt.match(
              /['"]?([a-zA-Z0-9_\-\.\/]+\.(?:log|md|json|txt|js|ts|py|html|sh))['"]?/i,
            );
            inputMapping[pathKey] = fileMatch ? fileMatch[1] : "output.txt";
          }
          if (
            typeof inputMapping[pathKey] === "string" &&
            inputMapping[pathKey].startsWith("/") &&
            !inputMapping[pathKey].startsWith("/home/") &&
            !inputMapping[pathKey].startsWith("/tmp/") &&
            !inputMapping[pathKey].startsWith("/var/")
          ) {
            inputMapping[pathKey] = inputMapping[pathKey].replace(/^\/+/, "");
          }
        }

        // 2. Content / Data / Body / Text parameter
        const contentKey = hasParam(/^(?:content|data|body|text|payload|message)$/i);
        if (contentKey && !inputMapping[contentKey]) {
          const incomingEdge = graph.edges.find((e) => e.target === node.id);
          const sourceNode = incomingEdge
            ? graph.nodes.find((n) => n.id === incomingEdge.source)
            : null;
          const sourceOutKey =
            (sourceNode?.config?.outputKey as string) ||
            Object.keys(graph.stateSchema).find((k) => k !== "input") ||
            "input";
          inputMapping[contentKey] = sourceOutKey;
        }

        // 3. Operation / Action parameter
        const opKey = hasParam(/^(?:operation|action|mode|method)$/i);
        if (opKey && !inputMapping[opKey]) {
          inputMapping[opKey] = "write";
        }

        // 4. Command / Script parameter
        const cmdKey = hasParam(/^(?:command|cmd|script)$/i);
        if (cmdKey) {
          let cmd = typeof inputMapping[cmdKey] === "string" ? inputMapping[cmdKey].trim() : "";

          // Resolve template references like ${tempFilePath.path} or ${tempFilePath}
          if (/\$\{[^}]*(?:temp|file|path)[^}]*\}/i.test(cmd)) {
            const priorFileNode = intermediateNodes.find((n) => {
              if (n.type !== "plugin") return false;
              const mapping = (n.config?.inputMapping || {}) as Record<string, any>;
              return Boolean(mapping.path || mapping.file || mapping.filename);
            });
            const priorPath =
              (priorFileNode?.config?.inputMapping as any)?.path ||
              (priorFileNode?.config?.inputMapping as any)?.file ||
              "/tmp/temp_file.ts";
            cmd = cmd.replace(/\$\{[^}]*(?:temp|file|path)[^}]*\}/gi, priorPath);
          }


          if (!cmd || cmd === "input") {
            cmd = "${input}";
          }

          inputMapping[cmdKey] = cmd;
        }

        // 5. Working Directory parameter
        const cwdKey = hasParam(/^(?:cwd|dir|workingDirectory)$/i);
        if (cwdKey && !inputMapping[cwdKey]) {
          inputMapping[cwdKey] = "${cwd}";
        }

        // 6. URL parameter
        const urlKey = hasParam(/^(?:url|uri|link)$/i);
        if (urlKey && !inputMapping[urlKey]) {
          inputMapping[urlKey] = "input";
        }

        // 7. Query / Search parameter
        const queryKey = hasParam(/^(?:query|search|keyword|term)$/i);
        if (queryKey && !inputMapping[queryKey]) {
          inputMapping[queryKey] = "input";
        }

        node.config = {
          pluginId: effectivePluginId,
          inputMapping,
          outputKey: outKey,
        };

        if (config.newStateProperties) {
          Object.assign(graph.stateSchema, config.newStateProperties);
        } else if (!graph.stateSchema[outKey]) {
          graph.stateSchema[outKey] = {
            type: "object",
            description: `Result from plugin ${effectivePluginId}`,
            required: false,
          };
        }

        yield {
          type: "node_updated",
          node,
          stateProperties: graph.stateSchema,
        };
      } catch (err: any) {
        console.warn(
          `[Visual Builder - Generator] Plugin Config failed for ${node.id}:`,
          err?.message,
        );
        const fallbackMapping: Record<string, any> = {};
        const expectedFallbackKeys = new Set([
          ...(pluginDef.parameterKeys || []),
        ]);
        const hasFallbackParam = (pattern: RegExp) =>
          Array.from(expectedFallbackKeys).find((k) => pattern.test(k));

        const fbPathKey = hasFallbackParam(/^(?:path|file|filename|filePath)$/i);
        if (fbPathKey) {
          const fileMatch = prompt.match(
            /['"]?([a-zA-Z0-9_\-\.\/]+\.(?:log|md|json|txt|js|ts|py|html|sh))['"]?/i,
          );
          fallbackMapping[fbPathKey] = fileMatch ? fileMatch[1] : "output.txt";
        }

        const fbContentKey = hasFallbackParam(/^(?:content|data|body|text|payload|message)$/i);
        if (fbContentKey) {
          const incomingEdge = graph.edges.find((e) => e.target === node.id);
          const sourceNode = incomingEdge
            ? graph.nodes.find((n) => n.id === incomingEdge.source)
            : null;
          fallbackMapping[fbContentKey] =
            (sourceNode?.config?.outputKey as string) ||
            Object.keys(graph.stateSchema).find((k) => k !== "input") ||
            "result";
        }

        const fbOpKey = hasFallbackParam(/^(?:operation|action|mode|method)$/i);
        if (fbOpKey) {
          fallbackMapping[fbOpKey] = "write";
        }

        const fbCmdKey = hasFallbackParam(/^(?:command|cmd|script)$/i);
        if (fbCmdKey) {
          fallbackMapping[fbCmdKey] = "${input}";
        }

        const fbCwdKey = hasFallbackParam(/^(?:cwd|dir|workingDirectory)$/i);
        if (fbCwdKey) {
          fallbackMapping[fbCwdKey] = "${cwd}";
        }

        const fbUrlKey = hasFallbackParam(/^(?:url|uri|link)$/i);
        if (fbUrlKey) {
          fallbackMapping[fbUrlKey] = "input";
        }

        const fbQueryKey = hasFallbackParam(/^(?:query|search|keyword|term)$/i);
        if (fbQueryKey) {
          fallbackMapping[fbQueryKey] = "input";
        }

        for (const reqKey of pluginDef.requiredKeys || []) {
          if (fallbackMapping[reqKey] === undefined) {
            fallbackMapping[reqKey] = "input";
          }
        }

        node.config = {
          pluginId: selectedPluginId,
          inputMapping: fallbackMapping,
          outputKey: `${node.id}_data`,
        };
        yield {
          type: "node_updated",
          node,
        };
      }
    } else if (node.type === "condition") {
      // Find what node feeds into this condition
      const incomingEdges = graph.edges.filter((e) => e.target === node.id);
      const incomingNodes = incomingEdges.map((e) =>
        graph.nodes.find((n) => n.id === e.source),
      );

      const currentKeys = Object.keys(graph.stateSchema);
      const conditionNodeSchema = buildConditionNodeSchema(currentKeys);
      const conditionAgent = configLlm.withStructuredOutput(
        conditionNodeSchema,
        {
          name: "ConditionConfig",
        },
      );

      const builderMessages = [
        new SystemMessage(`You are a Condition Node Configurator.
Node Name: "${node.name}" (ID: "${node.id}")
Incoming nodes: ${incomingNodes.map((n) => `[${n?.type}] ${n?.name}`).join(", ")}
${graphStateText}

Define the condition rule (field, operator, value) for the TRUE path.
Select the 'field' from the available state variables.
CRITICAL TYPING & FIELD SELECTION RULES:
- If the incoming node is a tool execution, command, script, or verification check:
  * The state variable contains the execution output text (e.g. 'check_output', 'verification_result').
  * To check for successful verification / passing: check that the output does NOT contain error indicators:
    field: '<preceding_node_output_key>', operator: 'not_contains', value: 'error' (or 'exit code')
  * NEVER use generic dummy keys like 'result' if a specific outputKey from the preceding node exists in State! Use the preceding node's exact outputKey!
- If the state variable is numeric (e.g. score, rating, count, attempts, percentage): use numeric operators ('greater_than', 'greater_than_or_equals', 'less_than', 'less_than_or_equals') and numeric values (e.g. 5, 80).
- If the state variable is categorical (e.g. category, status, severity): use 'equals' or 'not_equals' and string values (e.g. 'critical', 'passed', 'security').
- If the state variable is boolean (e.g. is_approved, is_valid, is_critical): use operator 'equals' and boolean value true or false (NOT string 'ok' or 'true').
- If checking collections or substrings: use 'contains', 'starts_with', or 'ends_with'.`),
        new HumanMessage(
          `Overall User Objective: "${prompt}"\nConfigure the condition rule.`,
        ),
      ];

      try {
        const config = (await conditionAgent.invoke(builderMessages)) as z.infer<
          typeof conditionNodeSchema
        >;

        let condField = config.condition.field;
        const incomingNode = incomingNodes[0];
        const incomingOutKey = incomingNode?.config?.outputKey as string | undefined;
        const incomingIsLlmOrAgent = incomingNode?.type === "llm" || incomingNode?.type === "agent";

        // Always remap to the actual outputKey of an upstream LLM/agent node:
        // the LLM configurator already set the field's type in stateSchema, so we trust that.
        if (incomingIsLlmOrAgent && incomingOutKey && condField !== incomingOutKey) {
          condField = incomingOutKey;
        } else if ((condField === "result" || !graph.stateSchema[condField]) && incomingOutKey) {
          // Fallback: remap generic or unknown fields for any node type
          condField = incomingOutKey;
        }

        let condOperator = config.condition.operator;
        let typedVal: unknown = config.condition.value;

        // Adapt tool/plugin check conditions: execution outputs are text strings, not boolean "true"
        if (
          incomingNode?.type === "plugin" &&
          condOperator === "equals" &&
          (String(typedVal).toLowerCase() === "true" ||
            String(typedVal).toLowerCase() === "ok" ||
            String(typedVal).toLowerCase() === "pass" ||
            String(typedVal).toLowerCase() === "success")
        ) {
          console.log(`[Visual Builder - Generator] Adapting tool verification condition for ${node.id}: not_contains "error"`);
          condOperator = "not_contains";
          typedVal = "error";
        }

        const fieldDef = graph.stateSchema[condField];

        const isNumericOp = [
          "greater_than",
          "greater_than_or_equals",
          "less_than",
          "less_than_or_equals",
        ].includes(condOperator);

        if (fieldDef?.type === "number" || isNumericOp) {
          typedVal = Number(typedVal);
          if (fieldDef) fieldDef.type = "number";
        } else if (
          fieldDef?.type === "boolean" ||
          condField.startsWith("is_") ||
          condField.endsWith("_valid") ||
          condField.endsWith("_approved") ||
          condField.endsWith("_anomaly")
        ) {
          if (typeof typedVal === "string") {
            const low = typedVal.toLowerCase().trim();
            typedVal = low === "true" || low === "ok" || low === "yes" || low === "pass" || low === "valid" || low === "anomaly" || low === "critical";
          } else {
            typedVal = Boolean(typedVal);
          }
          if (fieldDef) fieldDef.type = "boolean";
        } else {
          typedVal = String(typedVal);
        }

        node.config = {
          condition: {
            field: condField,
            operator: condOperator,
            value: typedVal,
          },
        };

        if (!graph.stateSchema[condField]) {
          graph.stateSchema[condField] = {
            type:
              typeof typedVal === "number"
                ? "number"
                : typeof typedVal === "boolean"
                  ? "boolean"
                  : "string",
            description: `Decision metric for ${node.name}`,
            required: false,
          };
        }

        yield {
          type: "node_updated",
          node,
          stateProperties: graph.stateSchema,
        };
      } catch (err: any) {
        console.warn(
          `[Visual Builder - Generator] Condition Config failed for ${node.id}:`,
          err?.message,
        );
        const boolField = currentKeys.find(
          (k) => k.startsWith("is_") || graph.stateSchema[k]?.type === "boolean",
        ) || "is_approved";

        node.config = {
          condition: {
            field: boolField,
            operator: "equals",
            value: true,
          },
        };
        yield {
          type: "node_updated",
          node,
        };
      }
    }
  }

  // ==========================================
  // PHASE 2.5: CONFIGURE END NODE DELIVERABLE (Structured Output Spec)
  // ==========================================
  console.log(`[Visual Builder - Generator] === Phase 2.5: Configuring End Node Deliverable ===`);
  yield {
    type: "planning",
    thoughts: "Configuring End Node Deliverable contract and structured output specification...",
  };

  const endWorkspaceDir = Deno.cwd();

  const endMessages = [
    new SystemMessage(`You are the Deliverable & Output Architect for an AI Agent Visual Builder.
Your task is to inspect the completed workflow and define the formal Structured Output Contract on the 'end' node.

User Objective: "${prompt}"

RUNTIME ENVIRONMENT:
- Workspace / Current Working Directory: "${endWorkspaceDir}"

Workflow Functional Steps & Configuration:
${intermediateNodes.map((n) => `- Node "${n.name}" (ID: "${n.id}", Type: "${n.type}"): config = ${JSON.stringify(n.config)}`).join("\n")}

Available State Variables:
${Object.keys(graph.stateSchema).map((k) => `- "${k}" (${graph.stateSchema[k]?.type || "string"}: ${graph.stateSchema[k]?.description || ""})`).join("\n")}

CRITICAL DELIVERABLE RULES:
1. If the workflow ends by saving or writing a file to disk:
   - type MUST be "file".
   - contentKey MUST be the state variable containing the actual text/markdown body that was written (e.g. from the preceding LLM reasoning step).
   - files MUST contain the file info (name, path).
     * For "path", look at the file path configured in the preceding node. Use the EXACT path configured in that node (e.g. "system_health.md" or "${endWorkspaceDir}/system_health.md").
     * NEVER invent dummy placeholder prefixes like "absolute/path/to/", "/path/to/", or "/current/working/directory/".
2. If the workflow produces an executive report, article, or analysis without saving to disk:
   - type MUST be "markdown".
   - contentKey MUST be the state variable containing the report.
3. If the workflow produces a list of records or tabular dataset:
   - type MUST be "table" or "json".
4. If the workflow evaluates a condition or decision check:
   - type MUST be "boolean".
5. If the workflow executes a terminal command without saving:
   - type MUST be "terminal".
6. USER RUNTIME INPUT REQUIREMENT:
   - Set requiresUserInput to true if this workflow processes, classifies, analyzes, or responds to dynamic runtime user messages, tickets, inquiries, questions, or text provided when the user runs the execution.
   - Set requiresUserInput to false if the workflow runs autonomously without user input (e.g. system diagnostics, reading hardware battery/CPU, cron scripts, fixed actions).
   - If requiresUserInput is true, provide an inputDescription explaining what the user should provide (e.g. 'Technical support ticket to classify', 'User search query', 'Text to process').`),
    new HumanMessage(`Define the final deliverable output contract for this workflow.`),
  ];

  let endConfig: z.infer<typeof endNodeConfigSchema> | null = null;
  try {
    endConfig = (await endAgent.invoke(endMessages)) as z.infer<typeof endNodeConfigSchema>;
    const sanitizedFiles = endConfig.files?.map((f) => {
      const raw = f.path || f.name;
      const clean = raw.replace(/^(?:\/?absolute\/path\/to\/|\/?current\/working\/directory\/|\/?path\/to\/)/i, "");
      return {
        ...f,
        path: clean,
      };
    });

    endNode.config = {
      output: {
        type: endConfig.type,
        summary: endConfig.summary,
        contentKey: endConfig.contentKey,
        ...(sanitizedFiles && sanitizedFiles.length > 0 ? { files: sanitizedFiles } : {}),
      },
    };
    console.log(
      `[Visual Builder - Generator] End Node configured with deliverable type "${endConfig.type}":`,
      JSON.stringify(endNode.config.output),
    );
  } catch (err: any) {
    console.warn(`[Visual Builder - Generator] End Node Config fallback:`, err?.message);
    const lastIntermediate = intermediateNodes[intermediateNodes.length - 1];
    const lastMapping = (lastIntermediate?.config?.inputMapping || {}) as Record<string, any>;
    const targetFilePath = lastMapping.path || lastMapping.file || lastMapping.filename;
    const isFileSavingStep = lastIntermediate?.type === "plugin" && typeof targetFilePath === "string";
    const prevNode = intermediateNodes[intermediateNodes.length - 2];
    const contentKey = (prevNode?.config?.outputKey as string) || (lastIntermediate?.config?.outputKey as string) || "result";

    endNode.config = {
      output: {
        type: isFileSavingStep ? "file" : "markdown",
        summary: "Workflow Deliverable",
        contentKey,
        ...(isFileSavingStep
          ? {
              files: [
                {
                  name: targetFilePath,
                  path: targetFilePath,
                  mimeType: "text/plain",
                },
              ],
            }
          : {}),
      },
    };
  }

  yield {
    type: "node_updated",
    node: endNode,
  };

  // Determine if 'input' is actually required by any node in the graph dynamically
  const anyNodeUsesInput = intermediateNodes.some((n) => {
    if (n.type === "plugin") {
      const mapping = (n.config?.inputMapping || {}) as Record<string, any>;
      return Object.values(mapping).some(
        (v) => typeof v === "string" && (v === "input" || v === "${input}" || v.includes("${input}")),
      );
    }
    if (n.type === "llm") {
      const sysPrompt = String(n.config?.systemPrompt || "");
      return (
        sysPrompt.includes("${input}") ||
        sysPrompt.includes("input message") ||
        sysPrompt.includes("input ticket") ||
        sysPrompt.includes("Use the input")
      );
    }
    return false;
  });

  const promptExplicitlyDemandsInput =
    /\b(?:del?\s+input|desde\s+el\s+input|del?\s+usuario|tome\s+(?:un\s+)?(?:mensaje|ticket|texto|query|consulta|pregunta)|recib(?:a|e|ir)\s+(?:un\s+)?(?:mensaje|ticket|texto|query|consulta|pregunta|input)|user\s+input|runtime\s+input)\b/i.test(
      prompt,
    );

  const isInputRequired = Boolean(
    endConfig?.requiresUserInput ||
      anyNodeUsesInput ||
      (intermediateNodes[0]?.type === "llm" && promptExplicitlyDemandsInput),
  );

  if (graph.stateSchema?.input) {
    graph.stateSchema.input.required = isInputRequired;
    if (endConfig?.inputDescription) {
      graph.stateSchema.input.description = endConfig.inputDescription;
    } else if (
      isInputRequired &&
      (!graph.stateSchema.input.description ||
        graph.stateSchema.input.description ===
          "User initial query or prompt for this execution")
    ) {
      graph.stateSchema.input.description =
        "User input or prompt to execute this workflow";
    }
  }

  console.log(
    `[Visual Builder - Generator] === Workflow Generation Complete ===`,
  );
  return graph;
}

