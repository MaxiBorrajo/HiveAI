import { createContext, useContext, type ReactNode } from "react";
import { listExecutions } from "@/features/executions/api/listExecutions";
import { deleteExecution } from "@/features/executions/api/deleteExecution";
import {
  updateExecution as updateExecutionRequest,
  type UpdateExecutionDto,
} from "@/features/executions/api/updateExecution";
import { useEntityListState } from "@/hooks/useEntityListState";
import type { ExecutionSummary } from "@/features/executions/types";

interface ExecutionsContextValue {
  executions: ExecutionSummary[];
  activeExecutionId: string | null;
  newExecutionToken: string;
  isLoadingExecutions: boolean;
  refreshExecutions: () => void;
  selectExecution: (id: string) => void;
  startNewExecution: () => void;
  deleteExecution: (id: string) => Promise<void>;
  updateExecution: (
    id: string,
    nameOrDto: string | { name: string },
  ) => Promise<void>;
  renameExecution: (id: string, name: string) => Promise<void>;
  onExecutionCreated: (id: string) => void;
  touchExecution: (id: string) => void;
}

const ExecutionsContext = createContext<ExecutionsContextValue | null>(null);

export function ExecutionsProvider({ children }: { children: ReactNode }) {
  const state = useEntityListState<ExecutionSummary, UpdateExecutionDto>(
    {
      list: listExecutions,
      remove: deleteExecution,
      // The backend returns the full `Execution` entity here (numeric `id`),
      // not an `ExecutionSummary` — only forward the fields the merge
      // function below actually reads.
      update: async (id, dto) => {
        const { data } = await updateExecutionRequest(id, dto);
        return { data: data ? { name: data.name, updatedAt: data.updatedAt } : undefined };
      },
    },
    (execution, dto, serverExecution) => ({
      ...execution,
      name: serverExecution?.name ?? dto.name,
      updatedAt: serverExecution?.updatedAt ?? Date.now(),
    }),
  );

  async function updateExecution(
    id: string,
    nameOrDto: string | { name: string },
  ) {
    const name = typeof nameOrDto === "string" ? nameOrDto : nameOrDto.name;
    await state.update(id, { name });
  }

  const value: ExecutionsContextValue = {
    executions: state.items,
    activeExecutionId: state.activeId,
    newExecutionToken: state.newItemToken,
    isLoadingExecutions: state.isLoading,
    refreshExecutions: state.refresh,
    selectExecution: state.select,
    startNewExecution: state.startNew,
    deleteExecution: state.remove,
    updateExecution,
    renameExecution: (id: string, name: string) => updateExecution(id, name),
    onExecutionCreated: state.onCreated,
    touchExecution: state.touch,
  };

  return (
    <ExecutionsContext.Provider value={value}>
      {children}
    </ExecutionsContext.Provider>
  );
}

export function useExecutions(): ExecutionsContextValue {
  const context = useContext(ExecutionsContext);
  if (!context) {
    throw new Error("useExecutions must be used within an ExecutionsProvider");
  }
  return context;
}
