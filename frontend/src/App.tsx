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

function AppContent() {
  const { openDraftName, closeDraft, notifyPluginImported } = useDraftEditor();
  const [currentView, setCurrentView] = useState<AppView>("chat");

  const {
    chats,
    activeChatId,
    isLoadingChats,
    selectChat,
    startNewChat,
    deleteChat,
    unreadChatIds,
  } = useChats();

  const {
    executions,
    activeExecutionId,
    isLoadingExecutions,
    selectExecution,
    startNewExecution,
    deleteExecution,
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
  };

  const executionProps = {
    list: executions.map((execution) => ({
      id: execution.id,
      title: execution.title,
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
