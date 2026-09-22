import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { listExecutions as listExecutionsRequest } from "@/lib/executions/listExecutions";
import { deleteExecution as deleteExecutionRequest } from "@/lib/executions/deleteExecution";
import type { ExecutionSummary } from "@/types/execution";

interface ExecutionsContextValue {
  executions: ExecutionSummary[];
  activeExecutionId: string | null;
  newExecutionToken: string;
  isLoadingExecutions: boolean;
  refreshExecutions: () => void;
  selectExecution: (id: string) => void;
  startNewExecution: () => void;
  deleteExecution: (id: string) => Promise<void>;
  onExecutionCreated: (id: string) => void;
  touchExecution: (id: string) => void;
}

const ExecutionsContext = createContext<ExecutionsContextValue | null>(null);

export function ExecutionsProvider({ children }: { children: ReactNode }) {
  const [executions, setExecutions] = useState<ExecutionSummary[]>([]);
  const [activeExecutionId, setActiveExecutionId] = useState<string | null>(
    null,
  );
  const [newExecutionToken, setNewExecutionToken] = useState(() =>
    crypto.randomUUID(),
  );
  const [isLoadingExecutions, setIsLoadingExecutions] = useState(false);

  function refreshExecutions() {
    setIsLoadingExecutions(true);
    listExecutionsRequest()
      .then(({ data }) => setExecutions(data ?? []))
      .finally(() => setIsLoadingExecutions(false));
  }

  useEffect(refreshExecutions, []);

  function selectExecution(id: string) {
    setActiveExecutionId(id);
  }

  function startNewExecution() {
    setActiveExecutionId(null);
    setNewExecutionToken(crypto.randomUUID());
  }

  function onExecutionCreated(id: string) {
    setActiveExecutionId(id);
    refreshExecutions();
  }

  function touchExecution(id: string) {
    setExecutions((prev) => {
      const index = prev.findIndex((e) => e.id === id);
      if (index === -1) return prev;

      const touched = { ...prev[index], updatedAt: Date.now() };
      const rest = prev.filter((e) => e.id !== id);
      return [touched, ...rest];
    });
  }

  async function deleteExecution(id: string) {
    await deleteExecutionRequest(id);
    if (activeExecutionId === id) {
      setActiveExecutionId(null);
      setNewExecutionToken(crypto.randomUUID());
    }
    refreshExecutions();
  }

  const value: ExecutionsContextValue = {
    executions,
    activeExecutionId,
    newExecutionToken,
    isLoadingExecutions,
    refreshExecutions,
    selectExecution,
    startNewExecution,
    deleteExecution,
    onExecutionCreated,
    touchExecution,
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
