
import { TooltipProvider } from "@/components/ui/tooltip";
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

function App() {

  return (
    <ToastProvider toastManager={toastManager}>
      <TooltipProvider>
        <ModelsProvider>
          <ChatsProvider>
            <div className="flex h-screen">
              <ChatsSidebar />
              <Chat />
            </div>
          </ChatsProvider>
        </ModelsProvider>
      </TooltipProvider>

      <ToastPortal>
        <ToastViewport>
          <ToastList />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  );
}

export default App;
