import {
  ToastProvider,
  ToastPortal,
  ToastViewport,
  ToastList,
} from "@/components/ui/toast";
import { Chat } from "@/components/Chat";
import { ChatsSidebar } from "@/components/ChatsSidebar";
import { toastManager } from "@/lib/toastManager";
import { ModelsProvider } from "@/context/ModelsContext";
import { ChatsProvider } from "@/context/ChatsContext";
import {
  DraftEditorProvider,
  useDraftEditor,
} from "@/components/PluginsManager/draft-editor-context";
import { DraftEditorPage } from "@/components/PluginsManager/DraftEditorPage";

function AppContent() {
  const { openDraftName, closeDraft, notifyPluginImported } = useDraftEditor();

  if (openDraftName) {
    return (
      <DraftEditorPage
        draftName={openDraftName}
        onClose={closeDraft}
        onImported={notifyPluginImported}
      />
    );
  }

  return (
    <div className="flex h-screen">
      <ChatsSidebar />
      <Chat />
    </div>
  );
}

function App() {
  return (
    <ToastProvider toastManager={toastManager}>
      <ModelsProvider>
        <ChatsProvider>
          <DraftEditorProvider>
            <AppContent />
          </DraftEditorProvider>
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
