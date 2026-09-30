import { ThemeProvider } from "next-themes";
import { useState } from "react";
import {
  ToastProvider,
  ToastPortal,
  ToastViewport,
  ToastList,
} from "@/components/ui/toast";
import { Chat } from "@/components/Chat";
import { AppSidebar } from "@/components/AppSidebar";
import { ViewSwitcher, type AppView } from "@/components/ViewSwitcher";
import { ExecutionsMain } from "@/components/Executions/ExecutionsMain";
import { toastManager } from "@/lib/toastManager";
import { ModelsProvider } from "@/context/ModelsContext";
import { ChatsProvider, useChats } from "@/context/ChatsContext";
import { ExecutionsProvider, useExecutions } from "@/context/ExecutionsContext";
import {
  DraftEditorProvider,
  useDraftEditor,
} from "@/components/PluginsManager/draft-editor-context";
import { DraftEditorPage } from "@/components/PluginsManager/DraftEditorPage";
import { DeleteConfirmationDialog } from "@/components/DeleteConfirmationDialog";
import { RenameDialog } from "@/components/RenameDialog";
import {
  buildSidebarProps,
  type DeleteTarget,
  type RenameTarget,
} from "@/lib/buildSidebarProps";

function AppContent() {
  const { openDraftName, closeDraft, notifyPluginImported } = useDraftEditor();
  const [currentView, setCurrentView] = useState<AppView>("chat");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);

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
  } = useExecutions();

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
      <AppSidebar
        {...sidebarProps}
        actions={
          <ViewSwitcher
            currentView={currentView}
            onViewChange={setCurrentView}
          />
        }
      />

      {currentView === "chat" ? <Chat /> : <ExecutionsMain />}

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
          <ChatsProvider>
            <ExecutionsProvider>
            <DraftEditorProvider>
                <AppContent />
              </DraftEditorProvider>
            </ExecutionsProvider>
        </ChatsProvider>
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
