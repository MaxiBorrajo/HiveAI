import { useState } from "react";
import {
  ToastProvider,
  ToastPortal,
  ToastViewport,
  ToastList,
} from "@/components/ui/toast";
import { Chat } from "@/components/Chat";
import { AppSidebar, type SidebarItem } from "@/components/AppSidebar";
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
import { Pencil, Trash2 } from "lucide-react";

function AppContent() {
  const { openDraftName, closeDraft, notifyPluginImported } = useDraftEditor();
  const [currentView, setCurrentView] = useState<AppView>("chat");
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    title?: string;
    entityName: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{
    id: string;
    title?: string;
    entityName: string;
    onConfirm: (newTitle: string) => Promise<void>;
  } | null>(null);

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

  const chatProps = {
    list: chats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    })),
    activeId: activeChatId,
    isLoading: isLoadingChats,
    selectItem: selectChat,
    startNew: startNewChat,
    deleteItem: deleteChat,
    unreadItemIds: unreadChatIds,
    sidebarTitle: "Chats",
    entityName: "Chat",
    loadingMessage: "Loading chats...",
    newTitle: "New chat",
    emptyTitle: "No chats yet",
    itemMenuOptions: [
      {
        label: "Rename",
        icon: <Pencil className="size-3.5" />,
        onClick: (item: SidebarItem) => {
          setRenameTarget({
            id: item.id,
            title: item.title,
            entityName: "Chat",
            onConfirm: async (newTitle: string) => {
              await renameChat(item.id, newTitle);
            },
          });
        },
      },
      {
        label: "Delete",
        icon: <Trash2 className="size-3.5" />,
        variant: "destructive" as const,
        onClick: (item: SidebarItem) => {
          setDeleteTarget({
            id: item.id,
            title: item.title,
            entityName: "Chat",
            onConfirm: async () => {
              await deleteChat(item.id);
            },
          });
        },
      },
    ],
  };

  const executionProps = {
    list: executions.map((execution) => ({
      id: execution.id,
      title: execution.name,
      createdAt: execution.createdAt,
      updatedAt: execution.updatedAt,
    })),
    activeId: activeExecutionId,
    isLoading: isLoadingExecutions,
    selectItem: selectExecution,
    startNew: startNewExecution,
    deleteItem: deleteExecution,
    unreadItemIds: new Set<string>(),
    sidebarTitle: "Executions",
    entityName: "Execution",
    loadingMessage: "Loading executions...",
    newTitle: "New execution",
    emptyTitle: "No executions yet",
    itemMenuOptions: [
      {
        label: "Rename",
        icon: <Pencil className="size-3.5" />,
        onClick: (item: SidebarItem) => {
          setRenameTarget({
            id: item.id,
            title: item.title,
            entityName: "Execution",
            onConfirm: async (newTitle: string) => {
              await renameExecution(item.id, newTitle);
            },
          });
        },
      },
      {
        label: "Delete",
        icon: <Trash2 className="size-3.5" />,
        variant: "destructive" as const,
        onClick: (item: SidebarItem) => {
          setDeleteTarget({
            id: item.id,
            title: item.title,
            entityName: "Execution",
            onConfirm: async () => {
              await deleteExecution(item.id);
            },
          });
        },
      },
    ],
  };

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
  );
}

export default App;
