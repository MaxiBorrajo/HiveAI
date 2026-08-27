import { useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Chat } from "@/components/Chat";
import { StyleGuide } from "@/components/StyleGuide";

function App() {
  const [showStyleGuide, setShowStyleGuide] = useState(false);

  return (
    <TooltipProvider>
      {showStyleGuide ? <StyleGuide /> : <Chat />}

      {/* Solo para nosotros mientras desarrollamos; sacar cuando el style guide ya no haga falta */}
      <button
        type="button"
        onClick={() => setShowStyleGuide((prev) => !prev)}
        className="fixed bottom-4 right-4 text-xs font-mono text-muted-foreground hover:text-foreground"
      >
        {showStyleGuide ? "Ver chat" : "Ver style guide"}
      </button>
    </TooltipProvider>
  );
}

export default App;
