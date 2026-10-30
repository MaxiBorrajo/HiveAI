import type { ModelRef } from "../providers/types.ts";
import { HiveMicrokernel } from "../../microkernel/hive-microkernel.ts";
import { runSignaturePhase } from "./signature-phase.ts";
import { runProcessPhase, type ProcessPhaseResult } from "./process-phase.ts";
import { runTestsPhase, type TestsPhaseResult } from "./tests-phase.ts";
import { validateDraft } from "./plugin-validator.ts";
import { serializePluginDraft } from "./code-serializer.ts";
import type { TestSuiteQualityReport } from "../../microkernel/plugin-quality-validator.ts";
import type { IncrementalPluginEvent, PluginDraft } from "./types.ts";

const MAX_VALIDATION_ATTEMPTS = 3;

export interface GeneratePluginResult {
  draft: PluginDraft;
  sourceCode: string;
  qualityReport?: TestSuiteQualityReport;
}

export async function* generateIncrementalPlugin(
  prompt: string,
  modelName: string,
  existingPluginNames: string[],
  hive: HiveMicrokernel,
  stagingDir: string,
  orchestrator?: ModelRef,
): AsyncGenerator<IncrementalPluginEvent, GeneratePluginResult, unknown> {
  yield {
    type: "planning",
    thoughts: "Designing the plugin's name, description and parameters...",
  };

  const signature = await runSignaturePhase(
    prompt,
    modelName,
    existingPluginNames,
    undefined,
    orchestrator,
  );
  yield { type: "signature_drafted", signature };

  let process = await runProcessPhase(prompt, signature, modelName, undefined, orchestrator);
  yield { type: "process_drafted", process };

  let tests = await runTestsPhase(prompt, signature, process, modelName, undefined, orchestrator);
  yield { type: "tests_drafted", tests };

  let draft: PluginDraft = { signature, process, tests };

  for (let attempt = 1; attempt <= MAX_VALIDATION_ATTEMPTS; attempt++) {
    yield { type: "validating" };
    const report = await validateDraft(hive, draft, stagingDir);
    if (report.valid) {
      const sourceCode = serializePluginDraft(draft);
      yield { type: "draft_ready", draft, sourceCode, qualityReport: report.qualityReport };
      return { draft, sourceCode, qualityReport: report.qualityReport };
    }

    yield { type: "validation_error", attempt, issues: report.issues };
    if (attempt === MAX_VALIDATION_ATTEMPTS) break;

    // Issues about test counts/kinds/params are the tests phase's fault;
    // a compile/runtime error (thrown by probeExternalPlugin) means the
    // process body itself is broken. Re-run the right phase only.
    if (report.compileError) {
      process = await runProcessPhase(prompt, signature, modelName, {
        previous: { thought: "", processSourceCode: process.processSourceCode, importsSourceCode: process.importsSourceCode },
        issues: [report.compileError],
      }, orchestrator);
      yield { type: "process_drafted", process };
      tests = await runTestsPhase(prompt, signature, process, modelName, undefined, orchestrator);
      yield { type: "tests_drafted", tests };
    } else {
      tests = await runTestsPhase(prompt, signature, process, modelName, {
        previous: { thought: "", selectionTests: tests.selectionTests, executionTests: tests.executionTests },
        issues: report.issues,
      }, orchestrator);
      yield { type: "tests_drafted", tests };
    }
    draft = { signature, process, tests };
  }

  const sourceCode = serializePluginDraft(draft);
  yield { type: "draft_ready", draft, sourceCode };
  return { draft, sourceCode };
}
