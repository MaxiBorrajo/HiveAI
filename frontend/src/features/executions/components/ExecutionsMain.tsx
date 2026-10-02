import { useState } from "react";
import { VisualBuilder } from "../visual-builder";
import { useExecutions } from "../ExecutionsContext";
import { useKeyedState } from "@/hooks/useKeyedState";
import { useExecutionWorkspace } from "../hooks/useExecutionWorkspace";
import { useGraphEditor } from "../hooks/useGraphEditor";
import { useRunControls } from "../hooks/useRunControls";
import { createExecution } from "../api/createExecution";
import { emptyGraph, hasNodeOfType } from "../lib/graphOps";
import { reportError } from "@/lib/toastManager";
import { getErrorMessage } from "@/lib/errors";
import { RunExecutionModal } from "./RunExecutionModal";
import { ExecutionResultSidebar } from "./ExecutionResultSidebar";
import { RunControlsBar } from "./RunControlsBar";
import { EmptyStateHeader } from "./EmptyStateHeader";
import { ExecutionChatPanel } from "./ExecutionChatPanel";
import { NodePaletteSidebar } from "./edit/NodePaletteSidebar";
import { EditModeBar } from "./edit/EditModeBar";
import { StateCard } from "./edit/StateCard";
import { ValidateGraphModal } from "./edit/ValidateGraphModal";
import { NodeDetailsPanel } from "./node-details/NodeDetailsPanel";

export function ExecutionsMain() {
  const {
    executions,
    activeExecutionId,
    onExecutionCreated,
    newExecutionToken,
  } = useExecutions();
  const [input, setInput] = useState("");
  const key = activeExecutionId || newExecutionToken;

  const selectedNodeIdState = useKeyedState<string | null>(key, null);
  const selectedEdgeIdState = useKeyedState<string | null>(key, null);
  const selectedNodeId = selectedNodeIdState.value;
  const selectedEdgeId = selectedEdgeIdState.value;
  const setSelectedNodeId = selectedNodeIdState.set;
  const setSelectedEdgeId = (id: string | null) => selectedEdgeIdState.set(id);

  const [isResultSidebarOpen, setIsResultSidebarOpen] = useState(false);
  const [isStateOpen, setIsStateOpen] = useState(false);

  const {
    isThinking,
    isRunning,
    graph,
    setGraph,
    isEditing,
    setIsEditing,
    draftGraph,
    setDraftGraph,
    adoptCreatedExecution,
    activeNodeId,
    planningThought,
    logs,
    executionResult,
    activeToolName,
    handleGenerate,
    handleStop,
    handleRun: runExecution,
  } = useExecutionWorkspace({
    key,
    activeExecutionId,
    newExecutionToken,
    selectedNodeId,
    setSelectedNodeId,
    onExecutionCreated,
  });

  const editor = useGraphEditor({
    executionId: activeExecutionId,
    graph,
    setGraph,
    isEditing,
    setIsEditing,
    draftGraph,
    setDraftGraph,
  });

  const runControls = useRunControls({
    graph,
    isThinking,
    isRunning,
    isEditing,
    runExecution,
    onResult: () => setIsResultSidebarOpen(true),
  });

  const displayGraph = isEditing ? draftGraph : graph;
  const isEmpty = !displayGraph && !isThinking;
  const selectedNode = displayGraph?.nodes.find((n) => n.id === selectedNodeId);
  const selectedEdge = displayGraph?.edges.find((e) => e.id === selectedEdgeId);

  const handleCreateManually = async () => {
    try {
      const { data } = await createExecution();
      if (data) adoptCreatedExecution(String(data.executionId), data.graph ?? emptyGraph());
    } catch (e) {
      reportError([`Could not create execution: ${getErrorMessage(e)}`]);
    }
  };

  const handleDiscard = () => {
    if (editor.isDirty && !globalThis.confirm("Discard your unsaved changes?")) return;
    editor.discard();
  };

  const handleDropNode: React.ComponentProps<typeof VisualBuilder>["onDropNode"] = (type, position) => {
    const id = editor.dropNode(type, position);
    if (id) setSelectedNodeId(id);
  };

  const handleDeleteNodes = (ids: string[]) => {
    editor.deleteNodes(ids);
    if (selectedNodeId && ids.includes(selectedNodeId)) setSelectedNodeId(null);
  };

  const handleDeleteEdges = (ids: string[]) => {
    editor.deleteEdges(ids);
    if (selectedEdgeId && ids.includes(selectedEdgeId)) setSelectedEdgeId(null);
  };

  const handleGenerateClick = async () => {
    if (!input.trim()) return;
    const userPrompt = input;
    setInput("");
    await handleGenerate(userPrompt);
  };

  return (
    <div className="flex flex-1 min-w-0 h-screen bg-background text-foreground font-sans overflow-hidden">
      <div className="flex flex-1 flex-col min-w-0 min-h-0 relative w-full">
        <div className="absolute inset-0 z-0">
          <VisualBuilder
            graph={displayGraph}
            editable={isEditing}
            errorNodeIds={editor.errorNodeIds}
            errorEdgeIds={editor.errorEdgeIds}
            onConnectNodes={editor.connect}
            onReconnectEdge={editor.reconnect}
            onDropNode={handleDropNode}
            onMoveNode={editor.moveNode}
            onDeleteNodes={handleDeleteNodes}
            onDeleteEdges={handleDeleteEdges}
            activeNodeId={activeNodeId}
            activeToolName={activeToolName}
            isGenerating={isThinking}
            planningThought={planningThought}
            selectedNodeId={selectedNodeId}
            onNodeSelect={setSelectedNodeId}
            selectedEdgeId={selectedEdgeId}
            onEdgeSelect={setSelectedEdgeId}
          />
        </div>

        <div className="absolute inset-0 z-10 pointer-events-none flex flex-col justify-between">
          <div className="flex items-center justify-end my-3 mx-4">
            {isEmpty && <EmptyStateHeader onCreateManually={handleCreateManually} />}
          </div>

          {isEditing && (
            <div className="absolute top-6 right-66 z-20 pointer-events-auto">
              <EditModeBar
                isDirty={editor.isDirty}
                isSaving={editor.saveStatus === "verifying"}
                disabled={isThinking}
                isStateOpen={isStateOpen}
                onToggleState={() => setIsStateOpen((open) => !open)}
                onSave={editor.save}
                onDiscard={handleDiscard}
              />
            </div>
          )}

          {!isEditing && (!isEmpty || isThinking || isRunning) && (
            <RunControlsBar
              graph={graph}
              logs={logs}
              hasResult={!!executionResult}
              isThinking={isThinking}
              isRunning={isRunning}
              hasRequiredInputs={runControls.hasRequiredInputs}
              onRun={runControls.runClick}
              onOpenRunModal={runControls.openRunModal}
              onShowResult={() => setIsResultSidebarOpen(true)}
              onEdit={editor.startEditing}
            />
          )}

          <NodeDetailsPanel
            node={selectedNode}
            edge={selectedNode ? undefined : selectedEdge}
            stateKeys={Object.keys(displayGraph?.stateSchema ?? {})}
            canEdit={isEditing && !isThinking}
            onApply={editor.editNode}
            onDeleteNode={(id) => handleDeleteNodes([id])}
            onDeleteEdge={(id) => handleDeleteEdges([id])}
          />

          {isEditing && isStateOpen && displayGraph && (
            <StateCard graph={displayGraph} onClose={() => setIsStateOpen(false)} />
          )}

          {(isEmpty || isEditing || isThinking) && (
            <ExecutionChatPanel
              input={input}
              setInput={setInput}
              isThinking={isThinking}
              isEmpty={isEmpty}
              isEditing={isEditing}
              selectedNode={selectedNode}
              selectedEdge={selectedEdge}
              onSend={handleGenerateClick}
              onStop={handleStop}
              onClearSelection={() => setSelectedNodeId(null)}
            />
          )}
        </div>
      </div>

      {isEditing && (
        <NodePaletteSidebar
          hasStart={hasNodeOfType(displayGraph, "start")}
          hasEnd={hasNodeOfType(displayGraph, "end")}
        />
      )}

      <ValidateGraphModal
        status={editor.saveStatus}
        violations={editor.violations}
        errors={editor.saveErrors}
        onClose={editor.closeSaveModal}
        onSelectNode={setSelectedNodeId}
      />

      <RunExecutionModal
        open={runControls.isRunModalOpen}
        onOpenChange={runControls.setIsRunModalOpen}
        graph={graph}
        hasRequiredInputs={runControls.hasRequiredInputs}
        runInputs={runControls.runInputs}
        setRunInputs={runControls.setRunInputs}
        onRun={() => runControls.run()}
      />

      <ExecutionResultSidebar
        isOpen={isResultSidebarOpen}
        onClose={() => setIsResultSidebarOpen(false)}
        data={executionResult}
        executionName={executions.find((e) => String(e.id) === activeExecutionId)?.name}
        onRunAgain={runControls.runClick}
      />
    </div>
  );
}
