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

function App() {
  const [showStyleGuide, setShowStyleGuide] = useState(false);

  return (
    <ToastProvider toastManager={toastManager}>
      <TooltipProvider>
        {showStyleGuide ? <StyleGuide /> : <Chat />}

        {/* Only for development; remove when the style guide is no longer needed */}
        <button
          type="button"
          onClick={() => setShowStyleGuide((prev) => !prev)}
          className="fixed bottom-4 right-4 text-xs font-mono text-muted-foreground hover:text-foreground"
        >
          {showStyleGuide ? "Show Chat" : "Show Style Guide"}
        </button>
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
