import { ChatOllama } from "@langchain/ollama";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { LangGraphAbstraction } from "../types.ts";
import {
  validateGraphInterpolationGrammar,
  validateGraphVariableReferences,
  validateGraphPluginParameters,
  validateGraphAgentToolMentions,
  type InputMappingViolation,
} from "../validation.ts";
import { runConfigStep } from "./generation-step.ts";
import { buildPluginConfigSchema } from "./plugin-node-configurator.ts";
import { PluginInfo } from "./topology-compiler.ts";
import type { IncrementalEvent } from "../generator.ts";

const MAX_GRAMMAR_RETRIES = 1;

export interface InterpolationSelfCorrectionContext {
  graph: LangGraphAbstraction;
  availablePlugins: PluginInfo[];
  configLlm: ChatOllama;
  nodeDescriptions: Map<string, string>;
}

/**
 * Phase 2.6: validates the graph's interpolation grammar/variable
 * references/plugin parameters/agent tool mentions (via validation.ts,
 * unchanged), yields a "validation_error" event per failing attempt, and
 * self-corrects violations — deterministically for tool-mention violations,
 * via an LLM re-invocation for plugin inputMapping violations, and via a
 * deterministic strip-to-bare-var fallback once MAX_GRAMMAR_RETRIES is
 * exceeded.
 */
export async function* runInterpolationSelfCorrection(
  ctx: InterpolationSelfCorrectionContext,
): AsyncGenerator<IncrementalEvent, void, unknown> {
  const { graph, availablePlugins, configLlm, nodeDescriptions } = ctx;

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
      if (toolMentionViolations.length > 0 && node.type === "llm") {
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

      const fixedMapping = await runConfigStep<z.infer<ReturnType<typeof buildPluginConfigSchema>>, Record<string, any> | null>({
        label: "Plugin Grammar Self-Correction",
        agent: pluginAgent,
        messages: correctionMessages,
        onSuccess: (corrected) => {
          const rawMapping = (corrected.inputMapping || {}) as Record<string, any>;
          const fixed: Record<string, any> = {};
          for (const [k, v] of Object.entries(rawMapping)) {
            fixed[k] =
              v && typeof v === "object" && "value" in v ? (v as any).value : v;
          }
          return fixed;
        },
        onFallback: (err: any) => {
          console.warn(
            `[Visual Builder - Generator] Grammar self-correction failed for ${node.id}:`,
            err?.message,
          );
          return null;
        },
      });

      if (fixedMapping) {
        node.config = { ...node.config, inputMapping: fixedMapping };
        yield { type: "node_fixed", node, stateProperties: graph.stateSchema };
      }
    }
  }
}
