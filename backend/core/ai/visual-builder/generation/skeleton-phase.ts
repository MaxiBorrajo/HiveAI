import type { ModelSelection } from "../../providers/model-selection.ts";
import { normalizeModelRef, type ModelRef } from "../../providers/types.ts";
import type {
  GraphNode,
  IncrementalEvent,
  LangGraphAbstraction,
  NormalizedSkeleton,
  PluginInfo,
} from "../types.ts";
import { askUser, canAskUser } from "./ask-user.ts";
import { findClarifyingQuestions } from "./clarification-check.ts";
import { runTopologyCompilerPhase } from "./topology-compiler.ts";
import { normalizeSkeletonToGraph } from "./skeleton-normalizer.ts";
import { findSkeletonShapeViolations } from "./skeleton-validator.ts";
import {
  fillMissingConditionBranches,
  findConvergingConditionBranches,
  findMissingConditionBranches,
} from "./graph-sanitizer.ts";

const MAX_SKELETON_RETRIES = 1;
const APPROVE_PLAN_OPTION = "Looks good, continue";

function describeKind(node: GraphNode): string {
  const config = (node.config ?? {}) as Record<string, unknown>;
  if (node.type === "llm") {
    const tools = Array.isArray(config.plugins) ? (config.plugins as string[]) : [];
    return tools.length > 0
      ? `an agent that uses ${tools.join(", ")}`
      : "an LLM step that reasons without tools";
  }
  if (node.type === "plugin") {
    return `runs the ${config.pluginId ?? "selected"} plugin directly`;
  }
  if (node.type === "condition") return "a condition that branches the flow";
  return node.type;
}

function describePlan(
  normalized: NormalizedSkeleton,
  existingGraph?: LangGraphAbstraction,
): string {
  const known = new Set(existingGraph?.nodes.map((n) => n.id));
  const planned = new Set(normalized.intermediateNodes.map((n) => n.id));

  const steps = normalized.intermediateNodes.map((node, index) => {
    const tag = !existingGraph
      ? ""
      : !known.has(node.id)
        ? " [new]"
        : normalized.modifiedIds.has(node.id)
          ? " [changed]"
          : " [unchanged]";
    const description = normalized.nodeDescriptions.get(node.id)?.trim();
    return `${index + 1}. ${node.name} — ${describeKind(node)}${tag}.${
      description ? ` ${description}` : ""
    }`;
  });

  const removed = (existingGraph?.nodes ?? [])
    .filter((n) => n.type !== "start" && n.type !== "end" && !planned.has(n.id))
    .map((n) => n.name);
  const removal = removed.length > 0
    ? `\n\nThis plan REMOVES: ${removed.join(", ")}.`
    : "";

  return `Here is how I plan to build it:\n\n${steps.join("\n")}${removal}\n\nContinue with this plan, or tell me what to change.`;
}

export async function* requestValidatedSkeleton(
  prompt: string,
  modelName: string,
  availablePlugins: PluginInfo[],
  graph: LangGraphAbstraction,
  existingGraph?: LangGraphAbstraction,
  orchestrator?: ModelRef,
  modelSelection?: ModelSelection,
): AsyncGenerator<IncrementalEvent, NormalizedSkeleton, unknown> {
  const nodesBefore = graph.nodes.length;
  let enrichedPrompt = prompt;

  if (canAskUser()) {
    const questions = await findClarifyingQuestions(
      prompt,
      availablePlugins,
      orchestrator ?? normalizeModelRef(modelName),
      existingGraph,
    );
    const answers: string[] = [];
    for (const { question, options } of questions) {
      const answer = yield* askUser(question, options, "clarify");
      if (answer) answers.push(`- ${question} → ${answer}`);
    }
    if (answers.length > 0) {
      enrichedPrompt += `\n\nClarifications provided by the user:\n${answers.join("\n")}`;
    }
  }

  let normalized: NormalizedSkeleton | undefined;
  while (true) {
    graph.nodes.length = nodesBefore;
    normalized = yield* buildSkeleton(
      enrichedPrompt,
      modelName,
      availablePlugins,
      graph,
      nodesBefore,
      existingGraph,
      orchestrator,
      modelSelection,
    );
    if (!canAskUser()) break;

    const answer = yield* askUser(
      describePlan(normalized, existingGraph),
      [APPROVE_PLAN_OPTION],
      "plan_review",
    );
    if (!answer || answer === APPROVE_PLAN_OPTION) break;

    enrichedPrompt += `\n\nThe user reviewed the proposed plan and asked for this change: ${answer}`;
    yield { type: "planning", thoughts: "Adjusting the plan with your feedback..." };
  }

  return normalized!;
}

async function* buildSkeleton(
  prompt: string,
  modelName: string,
  availablePlugins: PluginInfo[],
  graph: LangGraphAbstraction,
  nodesBefore: number,
  existingGraph?: LangGraphAbstraction,
  orchestrator?: ModelRef,
  modelSelection?: ModelSelection,
): AsyncGenerator<IncrementalEvent, NormalizedSkeleton, unknown> {
  let correctionContext:
    | { previousSkeleton: Awaited<ReturnType<typeof runTopologyCompilerPhase>>; violations: string[] }
    | undefined;

  for (let attempt = 1; attempt <= MAX_SKELETON_RETRIES + 1; attempt++) {
    const skeleton = await runTopologyCompilerPhase(
      prompt,
      modelName,
      availablePlugins,
      correctionContext,
      existingGraph,
      orchestrator,
      modelSelection,
    );

    yield { type: "planning", thoughts: skeleton.thought };

    graph.nodes.length = nodesBefore;
    const normalized = normalizeSkeletonToGraph(skeleton, graph, availablePlugins);

    const violations = [
      ...findSkeletonShapeViolations(skeleton),
      ...findMissingConditionBranches(normalized.intermediateNodes, normalized.rawEdges),
      ...findConvergingConditionBranches(normalized.intermediateNodes, normalized.rawEdges),
    ];
    if (violations.length === 0) return normalized;

    console.warn(
      `[Visual Builder - Generator] Skeleton attempt ${attempt} is invalid:`,
      violations,
    );

    if (attempt > MAX_SKELETON_RETRIES) {
      fillMissingConditionBranches(normalized.intermediateNodes, normalized.rawEdges);
      return normalized;
    }

    yield { type: "validation_error", violations, attempt };

    correctionContext = {
      previousSkeleton: skeleton,
      violations: violations.map((v) => v.reason),
    };
  }

  throw new Error("requestValidatedSkeleton: retry loop exited without a result");
}

