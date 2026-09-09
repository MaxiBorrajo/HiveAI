import { useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  ToastProvider,
  ToastPortal,
  ToastViewport,
  ToastList,
} from "@/components/ui/toast";
import { Chat } from "@/components/Chat";
import { StyleGuide } from "@/components/StyleGuide";
import { toastManager } from "@/lib/toastManager";
import { ModelsProvider } from "@/context/ModelsContext";

function App() {
  const [showStyleGuide, setShowStyleGuide] = useState(false);

  return (
    <ToastProvider toastManager={toastManager}>
      <TooltipProvider>
        <ModelsProvider>
          <Chat />
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
