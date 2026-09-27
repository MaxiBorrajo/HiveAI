import { ChatOllama } from "@langchain/ollama";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import {
  LangGraphAbstraction,
  GraphNode,
  GraphEdge,
  NodeType,
} from "./types.ts";
import { z } from "zod";
import {
  validateGraphInterpolationGrammar,
  validateGraphVariableReferences,
  validateGraphPluginParameters,
  validateGraphAgentToolMentions,
  type InputMappingViolation,
} from "./validation.ts";

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
  // The plugin's real Zod schema.shape, e.g. { query: ZodString, limit: ZodOptional<ZodNumber> }.
  // Used to build a per-node inputMapping schema that enforces each
  // parameter's ACTUAL type, instead of a generic string|number|boolean
  // union that would let the LLM emit e.g. "5" for a field that needs 5.
  parameterSchema?: Record<string, z.ZodTypeAny>;
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

// Local models on modest/no-GPU hardware can legitimately take minutes per
// call — this is a last-resort safety net against a truly stuck call, not a
// performance limit, so it's set very high on purpose.
const OLLAMA_CALL_TIMEOUT_MS = 30 * 60_000;
const OLLAMA_MAX_RETRIES = 2; // up to 3 total attempts

/**
 * Wraps a LangChain Runnable's .invoke() with a per-attempt timeout and a
 * bounded number of retries (linear backoff). Ollama can hang indefinitely
 * with no timeout of its own — this caps how long any single generation
 * step can block before its caller's existing fallback (heuristic skeleton,
 * emergency node config, etc.) takes over, instead of the whole generation
 * stalling forever.
 */
async function invokeWithRetry<T>(
  // deno-lint-ignore no-explicit-any
  runnable: { invoke: (input: any, config?: any) => Promise<T> },
  // deno-lint-ignore no-explicit-any
  input: any,
  label: string,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= OLLAMA_MAX_RETRIES + 1; attempt++) {
    try {
      return await runnable.invoke(input, { timeout: OLLAMA_CALL_TIMEOUT_MS });
    } catch (err) {
      lastErr = err;
      console.warn(
        `[Visual Builder - Generator] ${label} failed (attempt ${attempt}/${OLLAMA_MAX_RETRIES + 1}):`,
        err instanceof Error ? err.message : String(err),
      );
      if (attempt <= OLLAMA_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }
  throw lastErr;
}

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
 * Dynamic Zod schema for the incremental Topology Compiler: ONE node per
 * call instead of the whole graph at once. Each call either adds exactly one
 * node (with the already-built node(s) it connects FROM — outgoing edges are
 * inferred by the NEXT call, never invented for nodes that don't exist yet),
 * or signals the workflow is fully structured.
 */
function buildIncrementalStepSchema(availablePlugins: PluginInfo[]) {
  const pluginNames = availablePlugins.map((p) => p.name);
  const pluginEnum =
    pluginNames.length > 0
      ? z.enum(pluginNames as [string, ...string[]])
      : z.string();

  return z.object({
    isComplete: z
      .boolean()
      .describe(
        "true if the workflow described by the plan is now FULLY structured (every step from the plan has a corresponding node) and no more nodes are needed. false to add one more node.",
      ),
    node: z
      .object({
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
        description: z
          .string()
          .describe("What this specific node does in the flow"),
      })
      .optional()
      .describe(
        "The next node to add. Omit (or ignore) if isComplete is true.",
      ),
    incomingEdges: z
      .array(
        z.object({
          source: z
            .string()
            .describe(
              "Source node ID already built so far, or 'start' if this is the first node",
            ),
          path: z
            .string()
            .optional()
            .describe(
              "MANDATORY 'true'/'false' if source is a condition node",
            ),
        }),
      )
      .optional()
      .describe(
        "Which already-built node(s) connect INTO this new node. Almost always exactly one, except when a condition node's branch or a convergence point feeds this node.",
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
// "${varName}" only — a template reference resolved at runtime, accepted
// regardless of the parameter's declared type (the referenced state
// variable could hold any type at that point).
const templateRefSchema = z
  .string()
  .regex(/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/)
  .describe('A "${varName}" template reference to a state variable');

function buildPluginConfigSchema(
  availablePlugins: PluginInfo[],
  selectedPluginDef?: PluginInfo,
) {
  const pluginNames = availablePlugins.map((p) => p.name);
  const pluginEnum =
    pluginNames.length > 0
      ? z.enum(pluginNames as [string, ...string[]])
      : z.string();

  // If we know the real plugin for this node, build inputMapping's value
  // schema PER FIELD from its actual Zod types — a number field only
  // accepts a real number literal or a "${varName}" template string, never
  // a bare string like "5" for a field that expects a real number.
  let inputMappingSchema: z.ZodTypeAny;
  if (selectedPluginDef?.parameterSchema) {
    const fieldSchemas: Record<string, z.ZodTypeAny> = {};
    for (const [key, fieldSchema] of Object.entries(
      selectedPluginDef.parameterSchema,
    )) {
      fieldSchemas[key] = z.union([fieldSchema, templateRefSchema]);
    }
    inputMappingSchema = z.object(fieldSchemas).partial();
  } else {
    // Fallback: no known plugin shape — keep the generic union.
    inputMappingSchema = z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean()]),
    );
  }

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
    inputMapping: inputMappingSchema
      .optional()
      .describe(
        "Map each of THIS plugin's real parameters to either a literal value of its EXACT declared type (e.g. a real number for a number parameter, NOT a quoted string), or a \"${varName}\" template reference to a state variable (e.g. '${cwd}', or the exact outputKey of an upstream node in this graph). NEVER reference '${result}' — it is not populated until the whole workflow finishes and no node in the graph produces it. NEVER wrap values in objects like { staticValue: ... } or { value: ... }!",
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

function buildLlmConfigSchema(
  availablePlugins: PluginInfo[],
  availableStateKeys: string[] = [],
) {
  const pluginNames = availablePlugins.map((p) => p.name);
  const validKeys = availableStateKeys.filter((k) => k && k.trim().length > 0);
  const stateKeySchema =
    validKeys.length > 0
      ? z
          .enum(validKeys as [string, ...string[]])
          .describe(
            `Must be exactly one of the existing state variables: [${validKeys.join(", ")}]`,
          )
      : z.string().describe("Exact name of an existing state variable");

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
    inputMapping: z
      .record(z.string(), stateKeySchema)
      .optional()
      .describe(
        "Maps a descriptive label (shown to this node as its context header) to the BARE NAME (no '${}') of an existing state variable this node needs to read, e.g. { articles_to_compare: 'search_results' }. This REPLACES the full state dump at runtime — only what you declare here will be visible to this node.",
      ),
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
  | { type: "edge_added"; edge: GraphEdge }
  | {
      type: "validation_error";
      violations: InputMappingViolation[];
      attempt: number;
    }
  | {
      type: "node_fixed";
      node: GraphNode;
      stateProperties?: Record<string, any>;
    };

/**
 * Zod schema for configuring the End node deliverable contract (Structured Output).
 */
function buildEndNodeConfigSchema(availableStateKeys: string[] = []) {
  const validKeys = availableStateKeys.filter((k) => k && k.trim().length > 0);
  const contentKeySchema =
    validKeys.length > 0
      ? z
          .enum(validKeys as [string, ...string[]])
          .describe(
            `The exact state variable that holds the primary deliverable. Must be exactly one of: [${validKeys.join(", ")}]`,
          )
      : z
          .string()
          .describe(
            "The exact state memory variable that holds the primary deliverable (e.g. 'generate_summary_output', 'analysis_result', etc.)",
          );

  return z.object({
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
    contentKey: contentKeySchema,
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
}

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

  // Plain free-text reasoning model: no structured output, so it can think
  // through what the workflow needs without simultaneously having to commit
  // to node IDs/types/JSON — that commitment happens next, in the compiler.
  const plannerLlm = new ChatOllama({
    model: modelName,
    temperature: 0.2,
  });

  // Incremental Topology Compiler: builds ONE node per call instead of the
  // whole graph at once, to reduce the chance of losing coherence with the
  // plan across many nodes in a single structured-output call.
  const incrementalStepSchema = buildIncrementalStepSchema(availablePlugins);
  const compilerAgent = new ChatOllama({
    model: modelName,
    temperature: 0.1,
  }).withStructuredOutput(incrementalStepSchema, {
    name: "TopologyCompilerStep",
  });

  const criticLlm = new ChatOllama({
    model: modelName,
    temperature: 0.05,
  }).withStructuredOutput(workflowSkeletonSchema, {
    name: "ArchitectureCritic",
  });

  const configLlm = new ChatOllama({ model: modelName, temperature: 0.05 });
  // buildPluginConfigSchema is rebuilt per-node (both in Phase 2 and Phase
  // 2.6's self-correction) using that node's already-resolved pluginDef, so
  // inputMapping's per-field types come from the REAL plugin's Zod schema —
  // see the plugin branch below and the Phase 2.6 correction block.
  // buildLlmConfigSchema is rebuilt per-node inside the Phase 2 loop (its
  // inputMapping value enum needs the CURRENT graph.stateSchema keys at the
  // time each node is configured) — see the llm/agent branch below, same
  // pattern buildConditionNodeSchema already uses for condition nodes.
  // endAgent is built later, in Phase 2.5, once graph.stateSchema is fully
  // populated by every node's real outputKey (same reasoning: contentKey's
  // enum needs the final state keys, not whatever existed at setup time).

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
          // Deliberately NOT seeding "result" here: it is a runtime-only slot
          // that the executor writes AFTER the graph finishes (see
          // runExecution/index.ts), never before. Seeding it upfront made it
          // appear as an "available" variable to the Phase 2 node
          // configurators, which then hallucinated reads of "${result}" from
          // nodes that never actually produced it. The real mechanism for
          // referencing the final deliverable is the end node's contentKey,
          // which points at whatever outputKey the last producing node
          // actually used.
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
  // PHASE 0: FREE-TEXT PLANNER (reason BEFORE committing to structured JSON)
  // ==========================================
  yield {
    type: "planning",
    thoughts: "Thinking through what this workflow actually needs...",
  };

  const plannerPrompt = `You are the Lead Workflow Planner for an AI Agent Visual Builder.
Given the User's Objective and available plugins, describe in clear numbered PROSE (NOT JSON, no node IDs, no structured format) the sequence of steps this workflow needs.

Host Operating System: "${Deno.build.os}". Ensure any tool or shell steps you describe are compatible with this operating system.

Available Plugins and their parameter schemas:
${availablePlugins
  .map(
    (p) =>
      `- ${p.name}: ${p.description}\n  Parameters: ${p.parametersDescription || "none"}${p.returnDescription ? `\n  Returns: ${p.returnDescription}` : ""}`,
  )
  .join("\n")}

For EACH step, say:
- What it does.
- What KIND of step it is: a single deterministic tool call with fully pre-determined parameters ("plugin"); pure reasoning with no external tools ("llm"); an autonomous agent that invokes one or more tools in a dynamic observe → act → evaluate → act loop ("agent"); or a branching yes/no decision ("condition").
- What data it needs from earlier steps, and what data it produces for later steps.

CRITICAL RULES TO APPLY WHILE PLANNING (not just describing, but actually deciding the right shape):
1. Entry & Exit: the workflow always starts from a built-in "start" and always ends at a built-in "end" — never describe your own start/end step, only the functional steps in between.
2. Node Archetypes:
   - "plugin": ONLY for a step that executes exactly ONE tool call with fully pre-determined, static parameters — no decisions, no branching, no adaptation. Never chain two raw plugin steps directly if semantic translation, filtering, or decision-making is needed between them — that needs an "llm" step instead.
   - "llm": pure cognitive reasoning — consumes data already produced, reasons, produces new data. Never invokes an external tool.
   - "agent": a goal-driven step equipped with one or more tools, invoked in a dynamic loop. Use this whenever a step involves MULTIPLE related tool actions where the result of one action determines what to do next, or the agent must retry/refine/cross-reference across tool outputs.
   - "condition": an if/else routing decision evaluating a typed value, with exactly two outcomes.
3. CRITICAL — DO NOT FRAGMENT ONE AGENT'S TOOL CHAIN INTO SEPARATE STEPS: if a tool call's inputs or repetition count depend on a PRIOR tool call's result within the same logical task (e.g. "search for something, then read N of the resulting items"), describe ALL of those tool calls as belonging to ONE "agent" step with ALL the needed tools — not as a standalone tool-call step, followed by a step that only picks which items to use, followed by more standalone tool-call steps to fetch each item. That fragmentation forces later steps to consume a piece of a list/object they cannot cleanly reference, and duplicates work the agent could do itself.
   - WRONG (fragmented): step 1 "search the web" (plugin) → step 2 "pick the 2 best links" (llm/agent) → step 3 "read link 1" (plugin) → step 4 "read link 2" (plugin) → step 5 "compare" (llm)
   - RIGHT (collapsed): step 1 "search the web for the topic, pick the 2 most relevant results, and read each one" — ONE "agent" step with tools [web_search, web_read], producing one clear output → step 2 "compare the two articles" (llm) → step 3 "save to file" (plugin)
   - Only describe a standalone "plugin" step for a tool call whose parameters are ALREADY fully known before the workflow runs — never for a tool call whose target depends on a previous step's dynamic output.
4. Data Interpolation Constraint (affects what you can ask a later step to read): a later step can only read an EARLIER step's output as a whole value — it CANNOT reach into one specific field of a list/object produced earlier (e.g. it cannot pick "the first URL" out of a list by itself). If a later step needs one specific field/item out of a list/object an earlier step produced, you MUST describe an intermediate step (an "llm" or "agent") whose ONLY job is to read that full list/object and extract JUST the one field/item it needs, producing that as its own simple output. Never assume a step can reach into nested structure by itself.
5. Condition Patterns: a branching decision step always has exactly two outcomes (pass/fail, true/false) — describe both explicitly, including whether the "fail" branch ends the workflow or loops back to retry an earlier step.
6. Describe between 2 and 5 real functional steps that fully satisfy the user's objective.`;

  const plannerResponse = await invokeWithRetry(
    plannerLlm,
    [new SystemMessage(plannerPrompt), new HumanMessage(`User Objective: "${prompt}"`)],
    "Planner",
  );
  const planText = String(plannerResponse.content).trim();

  console.log(
    `[Visual Builder - Generator] Plan drafted:\n${planText}`,
  );
  yield {
    type: "planning",
    thoughts: planText,
  };

  // ==========================================
  // PHASE 1: TOPOLOGY COMPILER (Options 1 & 4)
  // ==========================================
  yield {
    type: "planning",
    thoughts: "Compiling the plan into the workflow structure...",
  };

  const compilerRulesText = `JSON STRUCTURING RULES:
1. Built-in Entry & Exit Terminals:
   - "start" and "end" ALREADY exist as the system's entry and exit nodes!
   - DO NOT create any node named "start", "Start", "end", or "End"!
   - The first node's incomingEdges source is "start".
2. Map each step in the plan to exactly one node, using the node "type" the plan already assigned to it (plugin/llm/agent/condition) — do not change a step's type, do not split or merge steps beyond what the plan describes.
3. For "plugin" nodes, set "pluginId" to the plugin from the available list that best matches the plan's description of that step.
4. Condition nodes have exactly two outgoing edges (path="true"/"false") — these are declared by the NODES THAT FOLLOW a condition node, via their own incomingEdges (each specifying source: <condition_node_id>, path: "true" or "false").
5. Use clean, descriptive lowercase IDs (e.g. 'search_news', 'analyze_metrics', 'anomaly_check').`;

  const MAX_INCREMENTAL_STEPS = 30; // safety ceiling against a model bug looping forever — NOT a real design limit
  type IncrementalNode = NonNullable<z.infer<typeof incrementalStepSchema>["node"]>;
  const incrementalNodes: IncrementalNode[] = [];
  const incrementalEdges: { source: string; target: string; path?: string }[] = [];

  for (let step = 0; step < MAX_INCREMENTAL_STEPS; step++) {
    const builtSoFarText =
      incrementalNodes.length > 0
        ? incrementalNodes
            .map((n, i) => `${i + 1}. [${n.type}] "${n.name}" (id: "${n.id}"): ${n.description}`)
            .join("\n")
        : "(none yet — this is the first node)";

    const compilerPrompt = `You are the Workflow Topology Compiler, building this workflow ONE NODE AT A TIME for an AI Agent Visual Builder.
A Planner has already decided WHAT this workflow needs, in prose. Your job is to convert it into nodes, one at a time, in the order the plan describes — do NOT re-invent or second-guess the plan's decisions about step count, step type, or step order.

Host Operating System: "${Deno.build.os}".

Available Plugins and their parameter schemas:
${availablePlugins
  .map(
    (p) =>
      `- ${p.name}: ${p.description}\n  Parameters: ${p.parametersDescription || "none"}${p.returnDescription ? `\n  Returns: ${p.returnDescription}` : ""}`,
  )
  .join("\n")}

THE PLAN TO STRUCTURE:
${planText}

NODES ALREADY BUILT SO FAR (in order):
${builtSoFarText}

YOUR TASK: Look at the plan and what's already built above. Either:
- If EVERY step from the plan now has a corresponding node above, set isComplete=true (omit "node").
- Otherwise, add EXACTLY ONE more node: whichever step from the plan comes next that isn't built yet. Do not skip ahead, do not add a node for a step already covered above, do not add more than one node.

${compilerRulesText}

For "incomingEdges": list which already-built node(s) (by id) this new node connects FROM. If this is the very first node, use "start". If a condition node's branch feeds this node, include the "path" ('true'/'false').`;

    let stepResult: z.infer<typeof incrementalStepSchema>;
    try {
      stepResult = (await invokeWithRetry(
        compilerAgent,
        [new SystemMessage(compilerPrompt), new HumanMessage(`User Objective: "${prompt}"`)],
        `Topology Compiler (step ${step + 1})`,
      )) as z.infer<typeof incrementalStepSchema>;
    } catch (err: any) {
      console.warn(
        `[Visual Builder - Generator] Topology Compiler step ${step + 1} failed:`,
        err?.message,
      );
      break; // keep whatever partial progress was already made
    }

    if (stepResult.isComplete || !stepResult.node) break;

    incrementalNodes.push(stepResult.node);
    for (const inc of stepResult.incomingEdges ?? []) {
      incrementalEdges.push({
        source: inc.source,
        target: stepResult.node.id,
        path: inc.path,
      });
    }
    yield {
      type: "planning",
      thoughts: `Compiled step ${step + 1}: "${stepResult.node.name}"`,
    };
  }

  let skeleton: z.infer<typeof workflowSkeletonSchema>;
  if (incrementalNodes.length > 0) {
    skeleton = {
      thought: planText,
      nodes: incrementalNodes,
      edges: incrementalEdges,
    };
    console.log(
      `[Visual Builder - Generator] Architecture designed: ${skeleton.nodes.length} nodes, ${skeleton.edges.length} edges`,
    );
  } else {
    console.warn(
      `[Visual Builder - Generator] Incremental Topology Compiler produced no nodes, using context-aware heuristic fallback.`,
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
Review the DRAFT workflow proposed by the Compiler for the User's Objective:
"${prompt}"

THE ORIGINAL PLAN this draft was supposed to structure (use this as the source of truth for intent — the draft must faithfully structure THIS plan, not diverge from it):
${planText}

Host Operating System: "${Deno.build.os}".

Available Plugins and their Capabilities:
${availablePlugins
  .map(
    (p) =>
      `- "${p.name}": ${p.description}\n  Parameters: ${p.parametersDescription || "none"}`,
  )
  .join("\n")}

Draft Nodes proposed:
${skeleton.nodes.map((n) => `- [${n.type}] "${n.name}" (ID: "${n.id}", pluginId: "${n.pluginId || "none"}"): ${n.description}`).join("\n")}

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

4. Fidelity to the Plan (CRITICAL):
   - The number of nodes in your corrected output should match the number of steps in THE ORIGINAL PLAN above — do NOT add extra nodes to "help" or split one planned step into several, and do NOT merge two distinct planned steps into one.
   - If the plan describes ONE step as a single agent invoking multiple tools in sequence (e.g. "search, then read the results"), the draft MUST have exactly ONE "agent" node for that step, not separate nodes for each tool call. If the draft already fragmented it into separate nodes, your correction MUST collapse them back into one "agent" node — do not add MORE nodes on top of the fragmentation.
   - Only fix genuine mismatches between the draft and the plan (wrong plugin choice, wrong node type, broken edges) — never restructure a step the plan already described correctly.

Return the refined, perfected workflow skeleton.`;

  try {
    const validated = (await invokeWithRetry(
      criticLlm,
      [
        new SystemMessage(criticPrompt),
        new HumanMessage("Validate and refine the workflow skeleton."),
      ],
      "Critic",
    )) as z.infer<typeof workflowSkeletonSchema>;

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

    const node: GraphNode = {
      id: cleanId,
      name: n.name,
      type: nodeType,
      config: nodeType === "plugin" ? { pluginId: cleanPluginId } : {},
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

  // Describes a real graph neighbor (predecessor/successor, resolved via
  // graph.edges) so each node's configurator can see what tools/outputKey a
  // neighbor already covers, instead of blindly duplicating them. Reads
  // config.plugins/outputKey directly, which is only meaningful for a
  // predecessor already configured earlier in this same sequential loop — a
  // successor not yet configured will only show its role/type.
  function describeNeighbor(n: GraphNode | undefined): string {
    if (!n) return "none";
    const role = nodeDescriptions.get(n.id) || n.name;
    const plugins = Array.isArray(n.config?.plugins)
      ? (n.config.plugins as string[])
      : [];
    const outputKey = n.config?.outputKey as string | undefined;
    return `"${n.name}" (type: ${n.type}, role: "${role}"${outputKey ? `, outputKey: "${outputKey}"` : ""}${plugins.length ? `, tools: [${plugins.join(", ")}]` : ""})`;
  }

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

    const predecessors = graph.edges
      .filter((e) => e.target === node.id)
      .map((e) => graph.nodes.find((n) => n.id === e.source));
    const successors = graph.edges
      .filter((e) => e.source === node.id)
      .map((e) => graph.nodes.find((n) => n.id === e.target));
    const neighborHint = `\nGraph Neighbors (use this to avoid duplicating work or tools already covered):
- Predecessor(s): ${predecessors.length ? predecessors.map(describeNeighbor).join("; ") : "none (this is the first node)"}
- Successor(s): ${successors.length ? successors.map(describeNeighbor).join("; ") : "none (this feeds into End)"}
IMPORTANT: If a predecessor already has a tool and produced an outputKey that already contains what you need, do NOT re-invoke that tool or duplicate its outputKey — read its output via a plain "\${outputKey}" reference instead. Only add a tool to THIS node if the predecessor's output does not already cover it.`;

    if (node.type === "llm" || node.type === "agent") {
      // Rebuilt per-node so inputMapping's value enum reflects the CURRENT
      // graph.stateSchema keys at the moment THIS node is configured (same
      // pattern buildConditionNodeSchema uses for condition nodes below).
      const currentStateKeysForLlm = Object.keys(graph.stateSchema);
      const dynamicLlmConfigSchema = buildLlmConfigSchema(
        availablePlugins,
        currentStateKeysForLlm,
      );
      const llmAgent = configLlm.withStructuredOutput(dynamicLlmConfigSchema, {
        name: "LLMConfig",
      });

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
          : node.type === "agent"
            ? `\nCRITICAL: This is an "agent" node — it MUST be equipped with tools. You MUST populate the "plugins" field with at least one plugin from the available list: [${Array.from(pluginNames).join(", ")}], chosen based on this node's mission: "${nodeDescriptions.get(node.id) || node.name}". Instruct it in systemPrompt to use its tools iteratively (observe → act → evaluate → act) to compile a thorough result before concluding.`
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
${neighborHint}
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
3. Read the Overall User Objective to understand the context, but fulfill ONLY this specific node's assigned mission ("${nodeRole}")!
4. Populate "inputMapping" with EVERY state variable this node's mission actually needs to read (using the exact state variable names listed above, or a Predecessor's outputKey shown above) — this determines EXACTLY what data this node sees at runtime; a variable NOT listed here will be invisible to it. Do not list variables it doesn't need; do not omit ones it does.
5. CRITICAL: In "systemPrompt", when you refer to data from "inputMapping", use ONLY the exact LABEL (the key you chose in inputMapping, e.g. if inputMapping is { "news_urls": "search_news_output" }, refer to it in systemPrompt as "news_urls" — NEVER as "search_news_output"). At runtime this node only sees its context blocks under the label names, not the underlying state variable names — mentioning the wrong name will make this node unable to find its own data.`),
        new HumanMessage(
          `Overall User Objective: "${prompt}"\n\nConfigure THIS node ("${node.name}", mission: "${nodeRole}").`,
        ),
      ];

      try {
        const config = (await invokeWithRetry(
          llmAgent,
          builderMessages,
          "LLM/Agent Node Configurator",
        )) as z.infer<ReturnType<typeof buildLlmConfigSchema>>;
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
        // "agent" nodes are exempt from this heuristic — an agent with zero tools is invalid.
        let finalPlugins =
          hasExternalPluginNodes && isCodingOrDraftingNode && node.type !== "agent"
            ? undefined
            : deduplicatedPlugins.length > 0
              ? deduplicatedPlugins
              : undefined;

        if (node.type === "agent" && !finalPlugins) {
          finalPlugins = availablePlugins[0] ? [availablePlugins[0].name] : undefined;
        }

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
          ...(config.inputMapping && Object.keys(config.inputMapping).length > 0
            ? { inputMapping: config.inputMapping }
            : {}),
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
        } else if (config.newStateProperties?.[outKey]) {
          // Only accept the schema entry for THIS node's own outKey — the LLM
          // sometimes throws in extra unrelated keys here, which would
          // otherwise pollute graph.stateSchema with names no node actually
          // produces (they'd then look "valid" to downstream inputMapping
          // enums, which are built from graph.stateSchema keys).
          graph.stateSchema[outKey] = config.newStateProperties[outKey];
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
        let finalPlugins = nodePlugins.length > 0 ? nodePlugins : undefined;
        if (node.type === "agent" && !finalPlugins) {
          finalPlugins = availablePlugins[0] ? [availablePlugins[0].name] : undefined;
        }
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

      const pluginConfigSchema = buildPluginConfigSchema(availablePlugins, pluginDef);
      const pluginAgent = configLlm.withStructuredOutput(pluginConfigSchema, {
        name: "PluginConfig",
      });

      const nodeRole = nodeDescriptions.get(node.id) || node.name;
      const builderMessages = [
        new SystemMessage(`You are a Plugin Node Configurator.
Node Name: "${node.name}" (ID: "${node.id}")
Node Operational Role / Purpose: "${nodeRole}"
${neighborHint}

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
2. Each parameter's value MUST match its REAL declared type (shown above under "Plugin Required & Optional Parameters") — if a parameter expects a number, provide a literal number (e.g. limit: 5, NOT limit: "5"); if it expects a boolean, provide a literal boolean; if it expects a string, provide a string. The ONLY exception is a "\${varName}" template reference (below), which is accepted regardless of the parameter's declared type.
   - For literal values: provide the raw value directly, in its correct type (e.g. command: "git status --short", operation: "write", path: "system_health.md", limit: 5).
   - For state memory references: use ONLY the exact template syntax "\${varName}", where varName is a single bare variable name with NO dots and NO brackets (e.g. "\${cwd}", "\${search_results}").
   - FORBIDDEN — NEVER write dot-path or bracket-index access such as "\${search_results.results[0].url}" or "\${search_results[1].url}". The runtime resolver treats everything inside "\${...}" as one flat literal key and does NOT walk into nested objects or arrays.
   - If you need a specific field out of a list/object (e.g. the URL of the top search result) rather than the whole variable, do NOT try to express that here. The upstream graph must already contain an "agent" or "llm" node dedicated to extracting that single field into its own scalar outputKey (e.g. "top_result_url") — then reference that scalar here as "\${top_result_url}".
     * WRONG: inputMapping: { "url": "\${search_results.results[0].url}" }
     * RIGHT: upstream "agent" node with outputKey "top_result_url", then this node: inputMapping: { "url": "\${top_result_url}" }
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
        const config = (await invokeWithRetry(
          pluginAgent,
          builderMessages,
          "Plugin Node Configurator",
        )) as z.infer<ReturnType<typeof buildPluginConfigSchema>>;
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

        if (config.newStateProperties?.[outKey]) {
          // Only accept the schema entry for THIS node's own outKey — see the
          // matching comment in the llm/agent branch for why unrelated keys
          // here must not pollute graph.stateSchema.
          graph.stateSchema[outKey] = config.newStateProperties[outKey];
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
        const config = (await invokeWithRetry(
          conditionAgent,
          builderMessages,
          "Condition Node Configurator",
        )) as z.infer<typeof conditionNodeSchema>;

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

  const endNodeConfigSchema = buildEndNodeConfigSchema(Object.keys(graph.stateSchema));
  const endAgent = configLlm.withStructuredOutput(endNodeConfigSchema, {
    name: "DeliverableConfig",
  });

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
    endConfig = (await invokeWithRetry(
      endAgent,
      endMessages,
      "End Node Configurator",
    )) as z.infer<typeof endNodeConfigSchema>;
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
    if (n.type === "llm" || n.type === "agent") {
      // llm/agent inputMapping values are bare state-key names (no "${}"),
      // so "input" itself (not "${input}") is the value to look for here.
      const mapping = (n.config?.inputMapping || {}) as Record<string, unknown>;
      if (Object.values(mapping).some((v) => v === "input")) return true;

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
      ((intermediateNodes[0]?.type === "llm" || intermediateNodes[0]?.type === "agent") &&
        promptExplicitlyDemandsInput),
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

  // ==========================================
  // PHASE 2.6: INTERPOLATION GRAMMAR VALIDATION & SELF-CORRECTION
  // ==========================================
  const MAX_GRAMMAR_RETRIES = 2;
  for (let attempt = 1; attempt <= MAX_GRAMMAR_RETRIES + 1; attempt++) {
    const violations = [
      ...validateGraphInterpolationGrammar(graph),
      ...validateGraphVariableReferences(graph),
      ...validateGraphPluginParameters(graph, availablePlugins),
      ...validateGraphAgentToolMentions(graph, availablePlugins),
    ];
    if (violations.length === 0) break;

    console.warn(
      `[Visual Builder - Generator] Interpolation grammar violations (attempt ${attempt}):`,
      JSON.stringify(violations),
    );
    yield { type: "validation_error", violations, attempt };

    if (attempt > MAX_GRAMMAR_RETRIES) {
      console.warn(
        `[Visual Builder - Generator] Max grammar retries exceeded; applying deterministic strip-to-bare-var fallback.`,
      );
      for (const v of violations) {
        const node = graph.nodes.find((n) => n.id === v.nodeId);
        if (!node) continue;

        if (v.kind === "unequipped_tool_mention") {
          const missingPlugin = v.reason.match(/mentions using the "([^"]+)" tool/)?.[1];
          const existingPlugins = Array.isArray(node.config?.plugins)
            ? (node.config.plugins as string[])
            : [];
          if (missingPlugin && !existingPlugins.includes(missingPlugin)) {
            node.config = {
              ...node.config,
              plugins: [...existingPlugins, missingPlugin],
            };
          }
          continue;
        }

        const mapping = {
          ...((node.config as any).inputMapping || {}),
        } as Record<string, any>;

        if (v.kind === "undefined_variable") {
          // No syntax to "strip" here — the reference is already a bare
          // identifier, it just points at nothing. Best-effort fix: rewire it
          // to the immediate predecessor node's real outputKey, if one exists.
          const incomingEdge = graph.edges.find((e) => e.target === node.id);
          const predecessor = incomingEdge
            ? graph.nodes.find((n) => n.id === incomingEdge.source)
            : undefined;
          const predecessorOutKey = predecessor?.config?.outputKey as string | undefined;
          if (predecessorOutKey && typeof mapping[v.field] === "string") {
            mapping[v.field] = mapping[v.field].replace(
              /\$\{[^}]*\}/g,
              `\${${predecessorOutKey}}`,
            );
          }
        } else if (typeof mapping[v.field] === "string") {
          mapping[v.field] = mapping[v.field].replace(
            /\$\{([^}]*)\}/g,
            (_m: string, inner: string) => `\${${inner.split(/[.[]/)[0]}}`,
          );
        }
        node.config = { ...node.config, inputMapping: mapping };
      }
      break;
    }

    const byNode = new Map<string, InputMappingViolation[]>();
    for (const v of violations) {
      if (!byNode.has(v.nodeId)) byNode.set(v.nodeId, []);
      byNode.get(v.nodeId)!.push(v);
    }

    const graphStateText = `Current Memory Variables (State):
${Object.entries(graph.stateSchema)
  .map(([k, v]) => `  - ${k} (${(v as any).type})`)
  .join("\n")}`;

    for (const [nodeId, nodeViolations] of byNode) {
      const node = graph.nodes.find((n) => n.id === nodeId);
      if (!node) continue;

      // Tool-mention violations (systemPrompt references a plugin not in
      // config.plugins) have an obvious mechanical fix: equip the tool.
      // Fixed deterministically, no LLM call needed.
      const toolMentionViolations = nodeViolations.filter(
        (v) => v.kind === "unequipped_tool_mention",
      );
      if (toolMentionViolations.length > 0 && (node.type === "llm" || node.type === "agent")) {
        const existingPlugins = Array.isArray(node.config?.plugins)
          ? (node.config.plugins as string[])
          : [];
        const missingPlugins = toolMentionViolations
          .map((v) => v.reason.match(/mentions using the "([^"]+)" tool/)?.[1])
          .filter((p): p is string => Boolean(p) && !existingPlugins.includes(p!));
        if (missingPlugins.length > 0) {
          node.config = {
            ...node.config,
            plugins: [...existingPlugins, ...missingPlugins],
          };
          yield { type: "node_fixed", node, stateProperties: graph.stateSchema };
        }
      }

      if (node.type !== "plugin") continue; // remaining violations only apply to plugin inputMapping

      const pluginId = (node.config as any)?.pluginId as string;
      const pluginDef =
        availablePlugins.find((p) => p.name === pluginId) ||
        availablePlugins[0];
      const nodeRole = nodeDescriptions.get(node.id) || node.name;

      const pluginConfigSchema = buildPluginConfigSchema(availablePlugins, pluginDef);
      const pluginAgent = configLlm.withStructuredOutput(pluginConfigSchema, {
        name: "PluginConfig",
      });

      const correctionMessages = [
        new SystemMessage(`You are a Plugin Node Configurator fixing an INVALID inputMapping.
Node Name: "${node.name}" (ID: "${node.id}")
Node Operational Role: "${nodeRole}"
Selected Plugin: "${pluginDef.name}"
Plugin Parameters: ${pluginDef.parametersDescription || "None"}

The previously generated inputMapping is INVALID:
${JSON.stringify((node.config as any).inputMapping)}

VALIDATION ERRORS (fix ALL of these):
${nodeViolations.map((v) => `- Field "${v.field}" = "${v.invalidValue}": ${v.reason}`).join("\n")}

CRITICAL RULE — INTERPOLATION GRAMMAR:
- Every value MUST be either a flat literal or contain ONLY bare "\${varName}" references (single identifier, NO dots, NO brackets).
- "\${search_results}" is valid. "\${search_results.results[0].url}" and "\${search_results[1].url}" are INVALID and FORBIDDEN.
- If you need one specific field out of a list/object, reference the FULL variable here (e.g. "\${search_results}") — extracting a specific field must happen in an upstream agent/llm node, not in this template string.
- If an error says a variable is "not produced by any node", that means NO node's outputKey equals that name — this INCLUDES "\${result}", which is only a placeholder and does NOT mean any node wrote to it. Replace it with the EXACT outputKey of the node that actually feeds this one (see the state variables listed below — each corresponds to a real node's outputKey).
${graphStateText}`),
        new HumanMessage(
          `Fix the inputMapping for node "${node.name}" so every value obeys the bare-\${varName} grammar. Do not invent dot/bracket paths.`,
        ),
      ];

      try {
        const corrected = (await invokeWithRetry(
          pluginAgent,
          correctionMessages,
          "Plugin Grammar Self-Correction",
        )) as z.infer<ReturnType<typeof buildPluginConfigSchema>>;
        const rawMapping = (corrected.inputMapping || {}) as Record<string, any>;
        const fixedMapping: Record<string, any> = {};
        for (const [k, v] of Object.entries(rawMapping)) {
          fixedMapping[k] =
            v && typeof v === "object" && "value" in v ? (v as any).value : v;
        }
        node.config = { ...node.config, inputMapping: fixedMapping };
        yield { type: "node_fixed", node, stateProperties: graph.stateSchema };
      } catch (err: any) {
        console.warn(
          `[Visual Builder - Generator] Grammar self-correction failed for ${node.id}:`,
          err?.message,
        );
      }
    }
  }

  console.log(
    `[Visual Builder - Generator] === Workflow Generation Complete ===`,
  );
  return graph;
}

