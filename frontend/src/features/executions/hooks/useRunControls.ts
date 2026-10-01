import { useEffect, useState } from "react";
import { reportError } from "@/lib/toastManager";
import { getErrorMessage } from "@/lib/errors";
import { graphRequiresInput } from "@/features/executions/lib/inputs";
import type { ExecutionResultData, LangGraphAbstraction } from "../types";

interface UseRunControlsOptions {
  graph: LangGraphAbstraction | null;
  isThinking: boolean;
  isRunning: boolean;
  isEditing: boolean;
  runExecution: (
    inputs: Record<string, any>,
    onResult: (result: ExecutionResultData) => void,
  ) => Promise<void>;
  onResult: () => void;
}

export function useRunControls({
  graph,
  isThinking,
  isRunning,
  isEditing,
  runExecution,
  onResult,
}: UseRunControlsOptions) {
  const [isRunModalOpen, setIsRunModalOpen] = useState(false);
  const [runInputs, setRunInputs] = useState<Record<string, any>>({});

  const hasRequiredInputs = graphRequiresInput(graph);

  const openRunModal = () => {
    if (!graph) return;
    const initialInputs: Record<string, any> = {};
    Object.keys(graph.stateSchema || {}).forEach((key) => {
      initialInputs[key] = "";
    });
    setRunInputs(initialInputs);
    setIsRunModalOpen(true);
  };

  const run = async (overrideInputs?: Record<string, any>) => {
    setIsRunModalOpen(false);

    try {
      await runExecution(overrideInputs ?? runInputs, onResult);
    } catch (e: any) {
      reportError([`Stream error: ${getErrorMessage(e)}`]);
    }
  };

  const runClick = () => {
    if (hasRequiredInputs) {
      openRunModal();
    } else {
      run({});
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (!isThinking && !isRunning && graph && !isEditing) {
          e.preventDefault();
          runClick();
        }
      }
    };
    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isThinking, isRunning, graph, hasRequiredInputs, isEditing]);

  return {
    isRunModalOpen,
    setIsRunModalOpen,
    runInputs,
    setRunInputs,
    hasRequiredInputs,
    openRunModal,
    run,
    runClick,
  };
}
