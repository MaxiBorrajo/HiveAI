import { ThemeProvider } from "next-themes";
import { useRef, useState } from "react";
import { FilePlus, Upload } from "lucide-react";
import { ImportFlowDialog } from "@/features/executions/components/ImportFlowDialog";
import {
  ToastProvider,
  ToastPortal,
  ToastViewport,
  ToastList,
} from "@/components/ui/toast";
import { Chat } from "@/features/chats";
import { AppSidebar } from "@/components/AppSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ViewSwitcher, type AppView } from "@/components/ViewSwitcher";
import { ExecutionsMain } from "@/features/executions/components/ExecutionsMain";
import { ServerOptimizationDialog } from "@/features/model-settings/components/ServerOptimizationDialog";
import { UpdateBanner } from "@/features/app-updates/components/UpdateBanner";
import { toastManager } from "@/lib/toastManager";
import { ModelsProvider } from "@/features/models/ModelsContext";
import { DownloadsProvider } from "@/features/models/DownloadsContext";
import { ChatsProvider, useChats } from "@/features/chats/ChatsContext";
import {
  ExecutionsProvider,
  useExecutions,
} from "@/features/executions/ExecutionsContext";
import {
  DraftEditorProvider,
  useDraftEditor,
} from "@/features/drafts/DraftEditorContext";
import { DraftEditorPage } from "@/features/drafts/components/DraftEditorPage";
import { DeleteConfirmationDialog } from "@/components/DeleteConfirmationDialog";
import { RenameDialog } from "@/components/RenameDialog";
import {
  buildSidebarProps,
  type DeleteTarget,
  type RenameTarget,
} from "@/components/buildSidebarProps";

function AppContent() {
  const { openDraftName, closeDraft, notifyPluginImported } = useDraftEditor();
  const [currentView, setCurrentView] = useState<AppView>("chat");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [importContent, setImportContent] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const {
    chats,
    activeChatId,
    isLoadingChats,
    selectChat,
    startNewChat,
    deleteChat,
    renameChat,
    unreadChatIds,
  } = useChats();

  const {
    executions,
    activeExecutionId,
    isLoadingExecutions,
    selectExecution,
    startNewExecution,
    deleteExecution,
    renameExecution,
    refreshExecutions,
    selectExecution: selectImportedExecution,
  } = useExecutions();

  async function handleImportFileChosen(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportContent(await file.text());
  }

  if (openDraftName) {
    return (
      <DraftEditorPage
        draftName={openDraftName}
        onClose={closeDraft}
        onImported={notifyPluginImported}
      />
    );
  }

  const chatProps = buildSidebarProps(
    {
      entityName: "Chat",
      sidebarTitle: "Chats",
      loadingMessage: "Loading chats...",
      newTitle: "New chat",
      emptyTitle: "No chats yet",
      items: chats,
      toSidebarItem: (chat) => ({
        id: chat.id,
        title: chat.title,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      }),
      activeId: activeChatId,
      isLoading: isLoadingChats,
      unreadItemIds: unreadChatIds,
      selectItem: selectChat,
      startNew: startNewChat,
      deleteItem: deleteChat,
      renameItem: renameChat,
    },
    setDeleteTarget,
    setRenameTarget,
  );

  const executionProps = buildSidebarProps(
    {
      entityName: "Execution",
      sidebarTitle: "Executions",
      loadingMessage: "Loading executions...",
      newTitle: "New execution",
      emptyTitle: "No executions yet",
      items: executions,
      toSidebarItem: (execution) => ({
        id: execution.id,
        title: execution.name,
        createdAt: execution.createdAt,
        updatedAt: execution.updatedAt,
      }),
      activeId: activeExecutionId,
      isLoading: isLoadingExecutions,
      selectItem: selectExecution,
      startNew: startNewExecution,
      deleteItem: deleteExecution,
      renameItem: renameExecution,
    },
    setDeleteTarget,
    setRenameTarget,
  );

  const sidebarProps = currentView === "chat" ? chatProps : executionProps;

  return (
    <div className="flex h-screen relative">
      <UpdateBanner />
      <ServerOptimizationDialog />
      <AppSidebar
        {...sidebarProps}
        newMenuOptions={
          currentView === "executions"
            ? [
                {
                  label: "Create new",
                  icon: <FilePlus className="size-3.5" />,
                  onClick: startNewExecution,
                },
                {
                  label: "Import",
                  icon: <Upload className="size-3.5" />,
                  onClick: () => importInputRef.current?.click(),
                },
              ]
            : undefined
        }
        actions={
          <>
            <div className="ml-2">
              <ViewSwitcher
                currentView={currentView}
                onViewChange={setCurrentView}
              />
            </div>
            <ThemeToggle />
          </>
        }
      />

      {currentView === "chat" ? <Chat /> : <ExecutionsMain />}

      <input
        ref={importInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleImportFileChosen}
      />

      <ImportFlowDialog
        fileContent={importContent}
        onClose={() => setImportContent(null)}
        onImported={(id) => {
          refreshExecutions();
          selectImportedExecution(id);
        }}
      />

      <DeleteConfirmationDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        itemName={deleteTarget?.title}
        entityName={deleteTarget?.entityName || ""}
        onConfirm={async () => {
          if (deleteTarget) {
            await deleteTarget.onConfirm();
          }
        }}
      />

      <RenameDialog
        open={!!renameTarget}
        onOpenChange={(open) => !open && setRenameTarget(null)}
        initialTitle={renameTarget?.title}
        entityName={renameTarget?.entityName || ""}
        onConfirm={async (newTitle) => {
          if (renameTarget) {
            await renameTarget.onConfirm(newTitle);
          }
        }}
      />
    </div>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <ToastProvider toastManager={toastManager}>
        <ModelsProvider>
          <DownloadsProvider>
            <ChatsProvider>
              <ExecutionsProvider>
                <DraftEditorProvider>
                  <AppContent />
                </DraftEditorProvider>
              </ExecutionsProvider>
            </ChatsProvider>
          </DownloadsProvider>
        </ModelsProvider>

        <ToastPortal>
          <ToastViewport>
            <ToastList />
          </ToastViewport>
        </ToastPortal>
      </ToastProvider>
    </ThemeProvider>
  );
}

export default App;
