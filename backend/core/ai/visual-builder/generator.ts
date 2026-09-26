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
  return partialMatch?.name || rawName.toLowerCase().replace(/-/g, "_");
}

/**
 * Dynamic Zod schema for Phase 1: Workflow Skeleton.
 * Relaxed and resilient to prevent local LLM formatting glitches from crashing generation.
 */
function buildWorkflowSkeletonSchema(availablePlugins: PluginInfo[]) {
  const pluginNames = availablePlugins.map((p) => p.name);

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
              "Node type: 'plugin' for single deterministic tool action (running bash, reading/writing files); 'llm' for cognitive reasoning/transformation OR autonomous agent; 'condition' for if/else routing diamond",
            ),
          pluginId: z
            .string()
            .optional()
            .describe(
              `Plugin ID if type is 'plugin' (e.g. 'run_shell', 'file_ops', 'file_read'). Available: [${pluginNames.join(", ")}]`,
            ),
          plugins: z
            .array(z.string())
            .optional()
            .describe(
              `ONLY for Autonomous Agent LLM nodes that need an active tool loop (e.g. ['web_search', 'web_read']). Leave empty for pure reasoning/summarizing LLM nodes. Available: [${pluginNames.join(", ")}]`,
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
 * Ensures the user NEVER gets an empty 1-node workflow without tools.
 */
function buildHeuristicSkeleton(
  prompt: string,
  availablePlugins: PluginInfo[],
) {
  const pLower = prompt.toLowerCase();
  const pluginNames = new Set(availablePlugins.map((p) => p.name));

  const needsWeb = /web|search|scrape|url|link|read|news|internet/i.test(pLower);
  const needsShell = /shell|bash|command|npm|test|cpu|ram|terminal/i.test(pLower);
  const needsFileOps = /save|file-ops|file_ops|write|markdown|json|log|system-alert/i.test(pLower);
  const needsFileSearch = /file_search|file-search|search.*file|fixme/i.test(pLower);

  // Pattern 1: OS Monitor with Alerts
  if (needsShell && /cpu|ram|metric|usage|anomal|alert/i.test(pLower)) {
    return {
      thought: "Creating operating system monitor with anomaly check and alert logging",
      nodes: [
        {
          id: "system_metrics",
          name: "Fetch System Metrics",
          type: "plugin" as const,
          pluginId: "run_shell",
          description: "Check CPU and RAM usage via shell",
        },
        {
          id: "llm_analyzer",
          name: "Analyze Metrics",
          type: "llm" as const,
          description: "Analyze metrics to detect critical anomalies and output a boolean flag",
        },
        {
          id: "anomaly_check",
          name: "Is Anomaly Detected?",
          type: "condition" as const,
          description: "Branch: normal ends flow, critical writes alert log",
        },
        {
          id: "write_alert",
          name: "Write Alert Log",
          type: "plugin" as const,
          pluginId: "file_ops",
          description: "Save alert details to system-alert.log",
        },
      ],
      edges: [
        { source: "start", target: "system_metrics" },
        { source: "system_metrics", target: "llm_analyzer" },
        { source: "llm_analyzer", target: "anomaly_check" },
        { source: "anomaly_check", target: "end", path: "false" },
        { source: "anomaly_check", target: "write_alert", path: "true" },
        { source: "write_alert", target: "end" },
      ],
    };
  }

  // Pattern 2: Code Refactor and Testing
  if (needsFileSearch && needsShell) {
    return {
      thought: "Creating refactoring and automated test verification workflow",
      nodes: [
        {
          id: "code_fixer",
          name: "Search and Propose Code Fix",
          type: "llm" as const,
          plugins: ["file_search", "file_read"].filter((p) => pluginNames.has(p)),
          description: "Search for FIXME tags, read code, and propose fix",
        },
        {
          id: "run_tests",
          name: "Run Automated Tests",
          type: "plugin" as const,
          pluginId: "run_shell",
          description: "Execute npm run test to verify fix",
        },
        {
          id: "tests_passed_check",
          name: "Did Tests Pass?",
          type: "condition" as const,
          description: "If tests pass, save changes; if failed, return error",
        },
        {
          id: "save_fix",
          name: "Save Fixed Code",
          type: "plugin" as const,
          pluginId: "file_ops",
          description: "Save the verified code changes to disk",
        },
      ],
      edges: [
        { source: "start", target: "code_fixer" },
        { source: "code_fixer", target: "run_tests" },
        { source: "run_tests", target: "tests_passed_check" },
        { source: "tests_passed_check", target: "save_fix", path: "true" },
        { source: "tests_passed_check", target: "end", path: "false" },
        { source: "save_fix", target: "end" },
      ],
    };
  }

  // Pattern 3: Web Research and Reports
  if (needsWeb && needsFileOps) {
    return {
      thought: "Creating web research, link evaluation and report generation workflow",
      nodes: [
        {
          id: "research_agent",
          name: "Web News Research",
          type: "llm" as const,
          plugins: ["web_search", "web_read"].filter((p) => pluginNames.has(p)),
          description: "Search web for recent news and gather information",
        },
        {
          id: "relevance_evaluator",
          name: "Evaluate Relevance",
          type: "llm" as const,
          description: "Evaluate if search results are relevant and sufficient",
        },
        {
          id: "relevance_check",
          name: "Are Results Relevant?",
          type: "condition" as const,
          description: "Quality gate: if relevant proceed, if not loop back to refine",
        },
        {
          id: "save_report",
          name: "Save Markdown Report",
          type: "plugin" as const,
          pluginId: "file_ops",
          description: "Save summary report to local filesystem",
        },
      ],
      edges: [
        { source: "start", target: "research_agent" },
        { source: "research_agent", target: "relevance_evaluator" },
        { source: "relevance_evaluator", target: "relevance_check" },
        { source: "relevance_check", target: "save_report", path: "true" },
        { source: "relevance_check", target: "research_agent", path: "false" },
        { source: "save_report", target: "end" },
      ],
    };
  }

  // Pattern 4: Web Scraping and Structured Data Extraction
  if (needsWeb && /extract|email|phone|json/i.test(pLower)) {
    return {
      thought: "Creating web scraping, entity extraction and JSON saving pipeline",
      nodes: [
        {
          id: "web_fetcher",
          name: "Fetch Web Content",
          type: "plugin" as const,
          pluginId: "web_read",
          description: "Scrape page content from URL",
        },
        {
          id: "data_extractor",
          name: "Extract Structured Data",
          type: "llm" as const,
          description: "Extract email addresses and phone numbers into JSON format",
        },
        {
          id: "save_json",
          name: "Save Extracted JSON",
          type: "plugin" as const,
          pluginId: "file_ops",
          description: "Save structured JSON via file-ops",
        },
      ],
      edges: [
        { source: "start", target: "web_fetcher" },
        { source: "web_fetcher", target: "data_extractor" },
        { source: "data_extractor", target: "save_json" },
        { source: "save_json", target: "end" },
      ],
    };
  }

  // General fallback: autonomous agent with available tools
  const toolsToGive = availablePlugins
    .filter((p) => {
      if (needsWeb && (p.name.includes("web") || p.name.includes("search"))) return true;
      if (needsShell && p.name.includes("shell")) return true;
      if (needsFileOps && p.name.includes("file")) return true;
      return false;
    })
    .map((p) => p.name);

  return {
    thought: "Creating resilient multi-step workflow with tools",
    nodes: [
      {
        id: "main_agent",
        name: "AI Agent",
        type: "llm" as const,
        plugins: toolsToGive.length > 0 ? toolsToGive : undefined,
        description: "Execute objective with available tools",
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

  return z.object({
    nodeId: z
      .string()
      .describe("Unique lowercase alphanumeric ID for this node"),
    nodeName: z
      .string()
      .describe("Human readable name (e.g. 'Search Google', 'Save Alert Log')"),
    pluginId: z
      .string()
      .describe(`The plugin ID to use. Available: [${pluginNames.join(", ")}]`),
    inputMapping: z
      .record(z.string(), z.any())
      .optional()
      .describe(
        "Map plugin parameter names to either existing state variables (e.g. { query: 'input', content: '${result}' }) OR static literal values (e.g. { command: 'npm test', operation: 'write', path: 'system-alert.log' }). MUST include all required parameters for this plugin!",
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

Available Plugins and their parameter schemas:
${availablePlugins
  .map(
    (p) =>
      `- ${p.name}: ${p.description}\n  Parameters: ${p.parametersDescription || "none"}`,
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
   - ARCHETYPE "plugin" (Deterministic Tool Execution):
     * Use when a step is purely executing a single mechanical tool with known/pre-configured parameters.
     * Examples: running a shell command ('run_shell'), reading a file from disk ('file_read'), writing content to a file ('file_ops'), getting current datetime ('current_datetime').
     * Control parameters (command, path, operation) MUST be static and pre-configured.
     * NEVER wrap an atomic tool action in an LLM if no thinking is required (e.g. saving text to a file is a 'plugin' file_ops, NOT an LLM agent!).
     * NEVER chain two raw plugins directly together if semantic translation, filtering, or decision-making is needed (e.g. NEVER do 'web_search' -> 'web_read' as plugins; use an autonomous agent instead).

   - ARCHETYPE "llm" (Pure Cognitive Reasoning - NO tools):
     * Consumes data already present in the state, reasons, and produces new data.
     * Use for analyzing, transforming, synthesizing, evaluating, scoring, or drafting content from the state.
     * Tools/plugins array MUST be EMPTY. It does NOT invoke external tools, it only thinks and writes to state.
     * If evaluating before a condition, set outputKey to a score (number), category (string), or approval flag (boolean).

   - ARCHETYPE "llm" with 'plugins' (Autonomous Problem-Solving Agent):
     * A goal-driven agent with tools that operates in an autonomous loop to explore, inspect, test, fix, or research when actions cannot be statically scripted in advance.
     * Use when the sequence of tool calls cannot be pre-determined because the next action depends on previous tool observations.
     * Examples: refactoring code and running tests iteratively, deep web research and multi-link extraction, sysadmin troubleshooting anomalies.
     * Do NOT use an Autonomous Agent for simple, linear steps that are already broken down into discrete steps (e.g. "run command X, then pass output to LLM to summarize, then save to file Y" is a 3-step pipeline: plugin -> llm -> plugin!).

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

Available Plugins: [${Array.from(pluginNames).join(", ")}]

Draft Nodes proposed:
${skeleton.nodes.map((n) => `- [${n.type}] "${n.name}" (ID: "${n.id}", pluginId: "${n.pluginId || "none"}", tools: [${(n.plugins || []).join(", ")}]): ${n.description}`).join("\n")}

Draft Edges proposed:
${skeleton.edges.map((e) => `- ${e.source} -> ${e.target} ${e.path ? `(${e.path})` : ""}`).join("\n")}

CRITICAL ARCHITECTURE AUDIT RULES:
1. Pure Tool Action vs LLM:
   - If a step is simply running a pre-defined command (e.g. 'ps', 'df', 'npm test') or reading/writing a file (e.g. 'file_ops', 'file_read'), it MUST be type: "plugin" (with pluginId set), NEVER an "llm"!
   - Writing/saving a file to disk is ALWAYS type: "plugin" (pluginId: "file_ops"), NOT an LLM agent!
   - Executing a pre-defined shell command is ALWAYS type: "plugin" (pluginId: "run_shell"), NOT an LLM agent!

2. Pure Reasoning vs Autonomous Agent:
   - If an LLM node's role is to summarize, analyze, give recommendations, score, or transform data already in the State, ensure its 'plugins' array is EMPTY. It is pure reasoning and does not need tools!
   - Keep 'plugins' on an LLM ONLY if the step requires an autonomous problem-solving agent with a dynamic loop (e.g. researching the web, searching files & fixing code, iterative debugging).

3. Edge & ID Integrity:
   - Ensure clean, descriptive IDs (e.g. 'run_shell_metrics', 'summarize_report', 'save_health_file').
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

    let cleanPluginId = normalizePluginName(n.pluginId, availablePlugins);
    if (n.type === "plugin") {
      if (!cleanPluginId || !pluginNames.has(cleanPluginId)) {
        const found = availablePlugins.find(
          (p) =>
            p.name.toLowerCase().includes(cleanId) ||
            n.description.toLowerCase().includes(p.name),
        );
        cleanPluginId = found?.name || availablePlugins[0]?.name || "web_search";
      }
    }

    let cleanPlugins = ((n as any).plugins as string[] | undefined)
      ?.map((p) => normalizePluginName(p, availablePlugins))
      .filter((p): p is string => Boolean(p && pluginNames.has(p)));

    const node: GraphNode = {
      id: cleanId,
      name: n.name,
      type: n.type,
      config:
        n.type === "plugin"
          ? { pluginId: cleanPluginId }
          : n.type === "llm" && cleanPlugins && cleanPlugins.length > 0
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
      const pRaw = (raw.path || "true").toLowerCase().trim();
      cleanPath =
        pRaw === "false" ||
        pRaw === "no" ||
        pRaw === "fail" ||
        pRaw === "retry" ||
        pRaw === "normal"
          ? "false"
          : "true";
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

  // 4. Invariant: Condition Nodes must have BOTH "true" and "false" paths
  for (const cn of intermediateNodes.filter((n) => n.type === "condition")) {
    const fromCn = rawEdges.filter((e) => e.source === cn.id);
    const hasTrue = fromCn.some((e) => e.path === "true");
    const hasFalse = fromCn.some((e) => e.path === "false");

    if (!hasTrue) {
      const unlinked = intermediateNodes.find(
        (n) => n.id !== cn.id && !rawEdges.some((e) => e.target === n.id),
      );
      const target = unlinked ? unlinked.id : "end";
      console.log(
        `[Visual Builder - Generator] Deterministic code: Auto-completing TRUE branch for condition "${cn.id}" -> "${target}"`,
      );
      rawEdges.push({
        id: `edge_${cn.id}_${target}_true`,
        source: cn.id,
        target,
        isConditional: true,
        path: "true",
      });
    }

    if (!hasFalse) {
      // Check for unlinked downstream node first (Branching pattern)
      const unlinked = intermediateNodes.find(
        (n) =>
          n.id !== cn.id &&
          !rawEdges.some((e) => e.target === n.id) &&
          !fromCn.some((e) => e.target === n.id),
      );
      if (unlinked) {
        console.log(
          `[Visual Builder - Generator] Deterministic code: Auto-completing FALSE branching for condition "${cn.id}" -> "${unlinked.id}"`,
        );
        rawEdges.push({
          id: `edge_${cn.id}_${unlinked.id}_false`,
          source: cn.id,
          target: unlinked.id,
          isConditional: true,
          path: "false",
        });
      } else {
        // Looping pattern: Find an earlier node to loop back to
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
              : feedsIntoCondition
                ? "boolean"
                : "string");

        const isNumeric = requestedType === "number";
        const isBooleanField = requestedType === "boolean";

        if (feedsIntoCondition && isBooleanField && !outKey.startsWith("is_")) {
          outKey = `is_${outKey.replace(/[^a-z0-9_]/g, "_")}`;
        }

        const finalPlugins =
          config.plugins && config.plugins.length > 0
            ? config.plugins
                .map((p) => normalizePluginName(p, availablePlugins))
                .filter((p): p is string => Boolean(p && pluginNames.has(p)))
            : nodePlugins.length > 0
              ? nodePlugins
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
            : config.systemPrompt,
          outputKey: outKey,
          ...(finalPlugins ? { plugins: finalPlugins } : {}),
          ...(isBooleanField
            ? { structuredOutput: { type: "boolean", required: true } }
            : isNumeric
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
      const selectedPluginId = (node.config.pluginId as string) || "file_ops";
      const pluginDef = availablePlugins.find((p) => p.name === selectedPluginId);

      const workspaceDir = Deno.cwd();
      const builderMessages = [
        new SystemMessage(`You are a Plugin Node Configurator.
Node Name: "${node.name}" (ID: "${node.id}")
Selected Plugin: "${selectedPluginId}"
Plugin Description: ${pluginDef?.description || ""}
Plugin Required & Optional Parameters:
${pluginDef?.parametersDescription || "None"}

RUNTIME ENVIRONMENT:
- Workspace / Current Working Directory: "${workspaceDir}"
- For file operations, always use the simple filename (e.g. "system_health.md") or relative path within the workspace. NEVER invent placeholder prefixes like "absolute/path/to/..." or "/path/to/...".

CRITICAL RULES FOR inputMapping:
1. You MUST provide values for all REQUIRED parameters of this plugin.
2. For each parameter in inputMapping, you can provide:
   - A static literal value: e.g. for run_shell command: "npm test" or "top -b -n 1"; for file_ops operation: "write", path: "system_health.md"
   - A reference to an existing memory variable: e.g. "input", "result", or "\${result}"
3. If the user objective specifies a concrete command, filename, query, or path, use that EXACT literal string!
${graphStateText}`),
        new HumanMessage(
          `Overall User Objective: "${prompt}"\nConfigure this plugin node.`,
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
        const effectivePluginId =
          normalizePluginName(config.pluginId || selectedPluginId, availablePlugins) ||
          selectedPluginId;

        const rawMapping = (config.inputMapping || {}) as Record<string, any>;
        const inputMapping: Record<string, any> = {};
        for (const [k, v] of Object.entries(rawMapping)) {
          if (v && typeof v === "object" && "value" in v) {
            inputMapping[k] = (v as any).value;
          } else {
            inputMapping[k] = v;
          }
        }

        // === DETERMINISTIC PARAMETER AUTO-COMPLETION & ENFORCEMENT ===
        // 1. file_ops enforcement
        if (effectivePluginId === "file_ops") {
          if (!inputMapping.operation) {
            inputMapping.operation = "write";
          }
          if (!inputMapping.path) {
            const fileMatch = prompt.match(
              /['"]?([a-zA-Z0-9_\-\.]+\.(?:log|md|json|txt|js|ts|py|html))['"]?/i,
            );
            inputMapping.path = fileMatch ? fileMatch[1] : "output.txt";
          }
          if (
            typeof inputMapping.path === "string" &&
            inputMapping.path.startsWith("/") &&
            !inputMapping.path.startsWith("/home/") &&
            !inputMapping.path.startsWith("/tmp/") &&
            !inputMapping.path.startsWith("/var/")
          ) {
            inputMapping.path = inputMapping.path.replace(/^\/+/, "");
          }
          if (!inputMapping.content) {
            const incomingEdge = graph.edges.find((e) => e.target === node.id);
            const sourceNode = incomingEdge
              ? graph.nodes.find((n) => n.id === incomingEdge.source)
              : null;
            const sourceOutKey =
              (sourceNode?.config?.outputKey as string) ||
              Object.keys(graph.stateSchema).find((k) => k !== "input") ||
              "input";
            inputMapping.content = sourceOutKey;
          }
        }

        // 2. run_shell enforcement
        if (effectivePluginId === "run_shell") {
          if (!inputMapping.command || inputMapping.command === "input") {
            if (/5\s*proceso|memoria.*(?:disco|disk)|procesos.*memoria/i.test(prompt)) {
              inputMapping.command = "ps aux --sort=-%mem | head -n 6 && df -h";
            } else if (/cpu|ram|memory|usage|metrics/i.test(prompt)) {
              inputMapping.command = "top -b -n 1 | head -n 25";
            } else if (/npm\s+run\s+test|npm\s+test|test/i.test(prompt)) {
              inputMapping.command = "npm test";
            } else if (/fixme/i.test(prompt)) {
              inputMapping.command = "grep -rn 'FIXME' .";
            } else if (/git\s+log/i.test(prompt)) {
              inputMapping.command = "git log -1 --stat";
            }
          }
        }

        // 3. web_read enforcement
        if (effectivePluginId === "web_read") {
          if (!inputMapping.url) {
            inputMapping.url = "input";
          }
        }

        // 4. web_search enforcement
        if (effectivePluginId === "web_search") {
          if (!inputMapping.query) {
            inputMapping.query = "input";
          }
        }

        // 5. file_read enforcement
        if (effectivePluginId === "file_read") {
          if (!inputMapping.operation) inputMapping.operation = "read";
          if (!inputMapping.path) inputMapping.path = "input";
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
        if (selectedPluginId === "run_shell") {
          fallbackMapping.command = /5\s*proceso|memoria.*(?:disco|disk)|procesos.*memoria/i.test(prompt)
            ? "ps aux --sort=-%mem | head -n 6 && df -h"
            : /cpu|ram|memory/i.test(prompt)
              ? "top -b -n 1 | head -n 25"
              : /test/i.test(prompt)
                ? "npm test"
                : "input";
        } else if (selectedPluginId === "file_ops") {
          fallbackMapping.operation = "write";
          const fileMatch = prompt.match(
            /['"]?([a-zA-Z0-9_\-\.]+\.(?:log|md|json|txt))['"]?/i,
          );
          fallbackMapping.path = fileMatch ? fileMatch[1] : "output.txt";
          const incomingEdge = graph.edges.find((e) => e.target === node.id);
          const sourceNode = incomingEdge
            ? graph.nodes.find((n) => n.id === incomingEdge.source)
            : null;
          fallbackMapping.content =
            (sourceNode?.config?.outputKey as string) ||
            Object.keys(graph.stateSchema).find((k) => k !== "input") ||
            "result";
        } else if (selectedPluginId === "web_read") {
          fallbackMapping.url = "input";
        } else if (selectedPluginId === "web_search") {
          fallbackMapping.query = "input";
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
CRITICAL TYPING RULES:
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

        const condField = config.condition.field;
        const fieldDef = graph.stateSchema[condField];
        let typedVal: unknown = config.condition.value;

        const isNumericOp = [
          "greater_than",
          "greater_than_or_equals",
          "less_than",
          "less_than_or_equals",
        ].includes(config.condition.operator);

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
            operator: config.condition.operator,
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
   - type MUST be "terminal".`),
    new HumanMessage(`Define the final deliverable output contract for this workflow.`),
  ];

  try {
    const endConfig = (await endAgent.invoke(endMessages)) as z.infer<typeof endNodeConfigSchema>;
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
    const isFileOps = lastIntermediate?.type === "plugin" && lastIntermediate?.config?.pluginId === "file_ops";
    const prevNode = intermediateNodes[intermediateNodes.length - 2];
    const contentKey = (prevNode?.config?.outputKey as string) || (lastIntermediate?.config?.outputKey as string) || "result";

    endNode.config = {
      output: {
        type: isFileOps ? "file" : "markdown",
        summary: "Workflow Deliverable",
        contentKey,
        ...(isFileOps
          ? {
              files: [
                {
                  name: (lastIntermediate?.config?.inputMapping as any)?.path || "output.txt",
                  path: (lastIntermediate?.config?.inputMapping as any)?.path || "output.txt",
                  mimeType: "text/markdown",
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

  // Determine if 'input' is actually required by any node in the graph
  const firstIntermediate = intermediateNodes[0];
  let isInputRequired = false;

  if (firstIntermediate) {
    if (firstIntermediate.type === "plugin") {
      const mapping = (firstIntermediate.config?.inputMapping || {}) as Record<string, any>;
      if (Object.values(mapping).some((v) => v === "input" || v === "${input}")) {
        isInputRequired = true;
      }
    } else if (firstIntermediate.type === "llm") {
      if (
        /\b(?:recib|ingres|usuario|pide|pedir|dynamic|topic|tema|query|pregunta)\b/i.test(prompt) &&
        !/\b(?:ejecut|corr|analiz|revis|guard|crea)\s+(?:un|el|los|las)\b/i.test(prompt)
      ) {
        isInputRequired = true;
      }
    }
  }

  if (graph.stateSchema?.input) {
    graph.stateSchema.input.required = isInputRequired;
  }

  console.log(
    `[Visual Builder - Generator] === Workflow Generation Complete ===`,
  );
  return graph;
}

