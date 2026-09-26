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
 * Dynamic Zod schema for Phase 1: Workflow Skeleton.
 * Strictly prevents the LLM from proposing 'start'/'end' as intermediate nodes,
 * forces pluginId to be one of the registered plugins, and forbids self-loops.
 */
function buildWorkflowSkeletonSchema(availablePlugins: PluginInfo[]) {
  const pluginNames = availablePlugins.map((p) => p.name);
  const pluginIdSchema =
    pluginNames.length > 0
      ? z
          .enum(pluginNames as [string, ...string[]])
          .optional()
          .describe(
            `Exact plugin ID to use. Available: [${pluginNames.join(", ")}]`,
          )
      : z.string().optional();

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
            .regex(
              /^[a-z0-9_]+$/,
              "ID must be lowercase alphanumeric with underscores",
            )
            .refine(
              (val) => !RESERVED_NODE_NAMES.includes(val.toLowerCase().trim()),
              {
                message:
                  "Cannot use reserved keywords 'start' or 'end' as node ID",
              },
            )
            .describe(
              "Unique lowercase identifier (e.g. search_info, analyze_quality, check_approval). DO NOT use 'start' or 'end'.",
            ),
          name: z
            .string()
            .refine(
              (val) => !["start", "end"].includes(val.toLowerCase().trim()),
              {
                message: "Cannot name an intermediate node 'Start' or 'End'",
              },
            )
            .describe(
              "Clear, concise title (e.g. 'Search Web', 'Analyze Quality', 'Is Approved?'). DO NOT name 'Start' or 'End'.",
            ),
          type: z
            .enum(["plugin", "llm", "condition"])
            .describe(
              "Node type: 'plugin' for single tool, 'llm' for AI reasoning or autonomous agent with tools, 'condition' for if/else routing diamond",
            ),
          pluginId: pluginIdSchema,
          plugins: z
            .array(
              pluginNames.length > 0
                ? z.enum(pluginNames as [string, ...string[]])
                : z.string(),
            )
            .optional()
            .describe(
              "FOR LLM AGENT NODES: list of plugins/tools this LLM can invoke autonomously (e.g. ['web_search', 'web_read'])",
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
        z
          .object({
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
                "MANDATORY if source is a condition node ('true' for pass/proceed, 'false' for loop-back/retry)",
              ),
          })
          .refine((edge) => edge.source !== edge.target, {
            message: "A node cannot connect to itself (self-loop forbidden)",
          }),
      )
      .describe(
        "Directed connections between nodes, including loops and condition true/false paths",
      ),
  });
}

/**
 * Dynamic Zod schema for configuring a Plugin node.
 * Locks pluginId to only existing plugins.
 */
function buildPluginConfigSchema(
  availablePlugins: PluginInfo[],
  availableStateKeys: string[] = ["input"],
) {
  const pluginNames = availablePlugins.map((p) => p.name);
  const pluginIdSchema =
    pluginNames.length > 0
      ? z
          .enum(pluginNames as [string, ...string[]])
          .describe(
            `The EXACT plugin ID to use. Available: [${pluginNames.join(", ")}]`,
          )
      : z.string();

  const validKeys = availableStateKeys.filter((k) => k && k.trim().length > 0);
  const stateVarSchema =
    validKeys.length > 0
      ? z
          .enum(validKeys as [string, ...string[]])
          .describe(
            `Must be an existing memory state variable: [${validKeys.join(", ")}]`,
          )
      : z.string();

  return z.object({
    nodeId: z
      .string()
      .describe("Unique lowercase alphanumeric ID for this new node"),
    nodeName: z
      .string()
      .describe(
        "Beautiful human readable name (e.g. 'Search Google', 'Read Webpage')",
      ),
    pluginId: pluginIdSchema,
    inputMapping: z
      .record(z.string(), stateVarSchema)
      .optional()
      .describe(
        "Map plugin parameter names to existing state memory variables (e.g. { query: 'input' }). NEVER use fake nested properties like search_results[0].url.",
      ),
    outputKey: z
      .string()
      .optional()
      .describe("Memory key to save the plugin result"),
    edgeCondition: edgeConditionSchema.optional(),
    newStateProperties: z
      .record(z.string(), statePropertyDefinitionSchema)
      .optional()
      .describe("If outputKey is new, define its schema here"),
  });
}

function buildLlmConfigSchema(availablePlugins: PluginInfo[]) {
  const pluginNames = availablePlugins.map((p) => p.name);
  const pluginsArraySchema =
    pluginNames.length > 0
      ? z
          .array(z.enum(pluginNames as [string, ...string[]]))
          .optional()
          .describe(
            `Tools/plugins this LLM can invoke autonomously. Available: [${pluginNames.join(", ")}]`,
          )
      : z.array(z.string()).optional();

  return z.object({
    nodeId: z
      .string()
      .describe("Unique lowercase alphanumeric ID for this new node"),
    nodeName: z
      .string()
      .describe(
        "Beautiful human readable name (e.g. 'Synthesize Findings', 'Validate Criteria')",
      ),
    plugins: pluginsArraySchema,
    pluginId: z.string().optional().describe("Optional plugin ID if needed"),
    systemPrompt: z.string().describe("The prompt instructions for the LLM node"),
    outputKey: z
      .string()
      .optional()
      .describe("Memory key to save the LLM result"),
    edgeCondition: edgeConditionSchema.optional(),
    newStateProperties: z
      .record(z.string(), statePropertyDefinitionSchema)
      .optional()
      .describe("If outputKey is new, define its schema here"),
  });
}

/**
 * Dynamic Zod schema for configuring a Condition node.
 * Constrains the field to actual memory keys existing in graph.stateSchema.
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
            "The exact state memory variable to check (e.g. 'is_valid', 'status', 'score')",
          );

  return z.object({
    nodeId: z
      .string()
      .describe("Unique lowercase alphanumeric ID for this condition node"),
    nodeName: z
      .string()
      .describe("Human readable name (e.g. Is Report Complete?)"),
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
            "is_empty",
            "is_not_empty",
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

  const configLlm = new ChatOllama({ model: modelName, temperature: 0.05 });
  const pluginConfigSchema = buildPluginConfigSchema(availablePlugins);
  const pluginAgent = configLlm.withStructuredOutput(pluginConfigSchema, {
    name: "PluginConfig",
  });
  const dynamicLlmConfigSchema = buildLlmConfigSchema(availablePlugins);
  const llmAgent = configLlm.withStructuredOutput(dynamicLlmConfigSchema, {
    name: "LLMConfig",
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
            required: true,
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
    thoughts: "Diseñando la arquitectura completa del flujo de trabajo...",
  };

  const architectPrompt = `You are the Lead Workflow Architect for an AI Agent Visual Builder.
Given the User's Objective and available plugins, design the COMPLETE topology of the workflow (all nodes and edges) in ONE cohesive architecture.

Available Plugins:
${availablePlugins.map((p) => `- ${p.name}: ${p.description}`).join("\n")}

CRITICAL ARCHITECTURE RULES:
1. Built-in Entry & Exit Terminals:
   - "start" and "end" ALREADY exist as the system's entry and exit nodes!
   - DO NOT create any node named "start", "Start", "end", or "End"!
   - DO NOT create dummy pass-through nodes to "prepare input" or "finalize process".
   - Your nodes must ONLY be real, functional processing steps (e.g. 'research_agent', 'quality_evaluator', 'approval_check').
   - The first functional processing step connects FROM "start".
   - The final functional step(s) connect TO "end".
2. Node Types & Autonomous Agents:
   - "llm": AI intelligence, evaluation, reasoning, OR an autonomous Agent with tools!
     * SUPERPOWER: When an objective asks to search the web, read pages, calculate, or do research:
       DO NOT create separate 'plugin' nodes for web_search and web_read!
       INSTEAD, create ONE 'llm' agent node equipped with tools: plugins: ['web_search', 'web_read']!
       The LLM agent will autonomously search the web, select the most relevant URLs, read them using 'web_read', and synthesize the complete report.
     * When an LLM node is an evaluator or reviewer before a condition, give it outputKey: 'is_valid' (or 'is_approved') and instruct it to return a boolean flag.
   - "plugin": to execute a single atomic standalone tool (e.g. current_datetime, counter, run_shell). Specify 'pluginId'.
     * CRITICAL PROHIBITION: NEVER connect a 'plugin' node directly into another 'plugin' node when the second plugin needs data parsed or selected from the first (e.g. NEVER do 'web_search' -> 'web_read')! Plugins cannot parse text, extract URLs, or index arrays.
   - "condition": decision diamond (if/else) for macro-control flow and quality gates.
3. MANDATORY CONDITION BRANCHES:
   - Every "condition" node MUST have EXACTLY TWO outgoing edges:
     * One edge with path="true" (what to do when condition passes).
     * One edge with path="false" (what to do when condition fails or needs retry).
4. LOOPS (Feedback cycles):
   - When a condition fails (path="false") or requires refinement, connect the edge's 'target' back to an earlier existing node (e.g. source: "quality_check", target: "research_agent", path: "false").
5. Do NOT repeat consecutive identical nodes; use an LLM agent with tools or a condition with a loop back instead.
6. Design between 2 and 5 real functional nodes for an optimal, focused workflow.`;

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
      `[Visual Builder - Generator] Architect LLM failed or schema rejected invalid structure, using fallback:`,
      err?.message,
    );
    skeleton = {
      thought: "Creating standard resilient workflow",
      nodes: [
        {
          id: "processor",
          name: "AI Processor",
          type: "llm",
          description: "Analyze and process user input",
        },
      ],
      edges: [
        { source: "start", target: "processor" },
        { source: "processor", target: "end" },
      ],
    };
  }

  yield {
    type: "planning",
    thoughts: skeleton.thought,
  };

  // 1. Inyectar determinísticamente por código el nodo Start nativo
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

  // 2. Filtrar determinísticamente cualquier intento de colar nodos dummy "start" o "end"
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
      // Find where this dummy start step pointed to
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

    let pluginId = n.pluginId;
    if (n.type === "plugin") {
      if (!pluginId || !pluginNames.has(pluginId)) {
        const found = availablePlugins.find(
          (p) =>
            p.name.toLowerCase().includes(n.id) ||
            n.description.toLowerCase().includes(p.name),
        );
        pluginId = found?.name || availablePlugins[0]?.name || "web-search";
      }
    }

    const node: GraphNode = {
      id: cleanId,
      name: n.name,
      type: n.type,
      config:
        n.type === "plugin"
          ? { pluginId }
          : n.type === "llm" && (n as any).plugins && (n as any).plugins.length > 0
            ? { plugins: (n as any).plugins }
            : {},
    };
    intermediateNodes.push(node);
    graph.nodes.push(node);
  }

  // 3. Inyectar determinísticamente por código el nodo End nativo
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

    // Check if source or target should be bypassed
    if (bypassMap.has(raw.source)) {
      continue; // outgoing edge from bypassed dummy node is replaced by incoming
    }
    if (bypassMap.has(raw.target)) {
      const realTarget = bypassMap.get(raw.target)!;
      t = idMap.get(realTarget) || realTarget;
    }
    // Prohibir auto-bucles de un nodo consigo mismo
    if (s === t) continue;
    if (!validNodeIds.has(s) || !validNodeIds.has(t)) continue;

    const sourceNode = graph.nodes.find((n) => n.id === s);
    const isCondition = sourceNode?.type === "condition";

    rawEdges.push({
      id: `edge_${s}_${t}${raw.path ? `_${raw.path}` : ""}`,
      source: s,
      target: t,
      isConditional: isCondition,
      path: isCondition ? raw.path ?? "true" : undefined,
    });
  }

  // Ensure Start has outgoing connection
  if (!rawEdges.some((e) => e.source === "start") && intermediateNodes.length > 0) {
    rawEdges.unshift({
      id: `edge_start_${intermediateNodes[0].id}`,
      source: "start",
      target: intermediateNodes[0].id,
      isConditional: false,
    });
  }

  // Ensure Condition Nodes have BOTH "true" and "false" paths
  for (const cn of intermediateNodes.filter((n) => n.type === "condition")) {
    const fromCn = rawEdges.filter((e) => e.source === cn.id);
    const hasTrue = fromCn.some((e) => e.path === "true");
    const hasFalse = fromCn.some((e) => e.path === "false");

    if (!hasTrue) {
      console.log(
        `[Visual Builder - Generator] Deterministic code: Auto-completing TRUE branch for condition "${cn.id}" -> "end"`,
      );
      rawEdges.push({
        id: `edge_${cn.id}_end_true`,
        source: cn.id,
        target: "end",
        isConditional: true,
        path: "true",
      });
    }

    if (!hasFalse) {
      // Find an earlier node to loop back to
      const candidates = intermediateNodes.filter(
        (n) => n.id !== cn.id && n.type !== "condition",
      );
      const loopTarget = candidates.length > 0 ? candidates[0].id : "end";
      console.log(
        `[Visual Builder - Generator] Deterministic code: Auto-completing FALSE loop branch for condition "${cn.id}" -> "${loopTarget}"`,
      );
      rawEdges.push({
        id: `edge_${cn.id}_${loopTarget}_false`,
        source: cn.id,
        target: loopTarget,
        isConditional: true,
        path: "false",
      });
    }
  }

  // Ensure path to End exists
  if (!rawEdges.some((e) => e.target === "end")) {
    const last = intermediateNodes[intermediateNodes.length - 1];
    if (last) {
      rawEdges.push({
        id: `edge_${last.id}_end`,
        source: last.id,
        target: "end",
        isConditional: last.type === "condition",
        path: last.type === "condition" ? "true" : undefined,
      });
    }
  }

  graph.edges = rawEdges;

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

  // Stream remaining edges (loops, secondary condition branches, end edges)
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
Instruct it in systemPrompt to use its tools iteratively (e.g. searching the web, reading multiple relevant URLs, extracting details) to compile a rich, thorough response before concluding.`
          : "";

      const conditionPromptHint = feedsIntoCondition
        ? `\nCRITICAL: This LLM node feeds directly into a condition/decision node.
You MUST instruct the model to produce a clear metric or status (e.g. 'is_valid', 'quality_score', 'status') and save it in 'outputKey'. Define this property in newStateProperties.`
        : "";

      const builderMessages = [
        new SystemMessage(`You are an LLM Node Configurator.
Node Name: "${node.name}" (ID: "${node.id}")
Configure the systemPrompt and memory outputKey for this node.
${agentToolHint}
${conditionPromptHint}
${graphStateText}`),
        new HumanMessage(
          `Overall User Objective: "${prompt}"\nConfigure this LLM node.`,
        ),
      ];

      try {
        const config = (await llmAgent.invoke(builderMessages)) as z.infer<
          ReturnType<typeof buildLlmConfigSchema>
        >;
        const outKey = config.outputKey || `${node.id}_result`;
        const finalPlugins =
          config.plugins && config.plugins.length > 0
            ? config.plugins
            : nodePlugins.length > 0
              ? nodePlugins
              : undefined;

        const isBooleanField =
          feedsIntoCondition ||
          outKey.startsWith("is_") ||
          outKey.endsWith("_valid") ||
          outKey.endsWith("_approved");

        node.config = {
          model: modelName,
          temperature: 0.1,
          systemPrompt: config.systemPrompt,
          outputKey: outKey,
          ...(finalPlugins ? { plugins: finalPlugins } : {}),
          ...(isBooleanField
            ? { structuredOutput: { type: "boolean", required: true } }
            : {}),
        };

        if (config.newStateProperties) {
          Object.assign(graph.stateSchema, config.newStateProperties);
        } else if (!graph.stateSchema[outKey]) {
          graph.stateSchema[outKey] = {
            type: isBooleanField ? "boolean" : "string",
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
          ? `${node.id}_approved`
          : `${node.id}_result`;
        node.config = {
          model: modelName,
          temperature: 0.1,
          systemPrompt: feedsIntoCondition
            ? `Evaluate if the research meets sufficient depth and quality standards. Output whether it is approved.`
            : finalPlugins
              ? `You are an autonomous research agent. Use your tools [${finalPlugins.join(", ")}] to search and read relevant pages, synthesize the findings, and generate a comprehensive report.`
              : `Analyze and synthesize the results for the task: ${prompt}`,
          outputKey: outKey,
          ...(finalPlugins ? { plugins: finalPlugins } : {}),
        };
        if (!graph.stateSchema[outKey]) {
          graph.stateSchema[outKey] = {
            type: feedsIntoCondition ? "boolean" : "string",
            description: `Output of ${node.name}`,
            required: false,
          };
        }
        yield {
          type: "node_updated",
          node,
          stateProperties: graph.stateSchema,
        };
      }
    } else if (node.type === "plugin") {
      const builderMessages = [
        new SystemMessage(`You are a Plugin Node Configurator.
Node Name: "${node.name}" (ID: "${node.id}")
Available Plugins:
${availablePlugins.map((p) => `- ${p.name}: ${p.description}`).join("\n")}
Select the correct pluginId, map input parameters, and define outputKey.
${graphStateText}`),
        new HumanMessage(
          `Overall User Objective: "${prompt}"\nConfigure this plugin node.`,
        ),
      ];

      try {
        const config = (await pluginAgent.invoke(builderMessages)) as z.infer<
          ReturnType<typeof buildPluginConfigSchema>
        >;
        const outKey = config.outputKey || `${node.id}_data`;

        node.config = {
          pluginId: node.config.pluginId || config.pluginId,
          inputMapping: config.inputMapping || { query: "input" },
          outputKey: outKey,
        };

        if (config.newStateProperties) {
          Object.assign(graph.stateSchema, config.newStateProperties);
        } else if (!graph.stateSchema[outKey]) {
          graph.stateSchema[outKey] = {
            type: "object",
            description: `Result from plugin ${node.config.pluginId}`,
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

      // Dynamic condition schema strictly constrained to available memory variables
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
Select the 'field' from the available state variables.`),
        new HumanMessage(
          `Overall User Objective: "${prompt}"\nConfigure the condition rule.`,
        ),
      ];

      try {
        const config = (await conditionAgent.invoke(builderMessages)) as z.infer<
          typeof conditionNodeSchema
        >;

        const condField = config.condition.field;
        const fieldDef = graph.stateSchema[condField];
        let typedVal: unknown = config.condition.value;

        // Force exact type matching
        if (
          fieldDef?.type === "boolean" ||
          condField.startsWith("is_") ||
          condField.endsWith("_valid") ||
          condField.endsWith("_approved")
        ) {
          if (typeof typedVal === "string") {
            typedVal = typedVal.toLowerCase().trim() === "true";
          } else {
            typedVal = Boolean(typedVal);
          }
        } else if (fieldDef?.type === "number") {
          typedVal = Number(typedVal);
        } else if (fieldDef?.type === "string") {
          typedVal = String(typedVal);
        }

        node.config = {
          condition: {
            field: condField,
            operator: config.condition.operator,
            value: typedVal,
          },
          model: modelName,
        };

        // Guarantee condition field is registered in state schema
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
        // Fallback condition
        node.config = {
          condition: {
            field: currentKeys.find((k) => k !== "input") || "is_valid",
            operator: "equals",
            value: true,
          },
          model: modelName,
        };
        yield {
          type: "node_updated",
          node,
        };
      }
    }
  }

  console.log(
    `[Visual Builder - Generator] === Workflow Generation Complete ===`,
  );
  return graph;
}

