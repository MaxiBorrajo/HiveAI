import type { ModelSelection } from "../../providers/model-selection.ts";
import type { ModelRef } from "../../providers/types.ts";
import type {
  IncrementalEvent,
  LangGraphAbstraction,
  NormalizedSkeleton,
  PluginInfo,
} from "../types.ts";
import { runTopologyCompilerPhase } from "./topology-compiler.ts";
import { normalizeSkeletonToGraph } from "./skeleton-normalizer.ts";
import { findSkeletonShapeViolations } from "./skeleton-validator.ts";
import {
  fillMissingConditionBranches,
  findConvergingConditionBranches,
  findMissingConditionBranches,
} from "./graph-sanitizer.ts";

const MAX_SKELETON_RETRIES = 1;

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

