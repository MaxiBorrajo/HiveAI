import { useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Chat } from "@/components/Chat";
import { StyleGuide } from "@/components/StyleGuide";
import {
  DraftEditorProvider,
  useDraftEditor,
} from "@/components/PluginsManager/draft-editor-context";
import { DraftEditorPage } from "@/components/PluginsManager/DraftEditorPage";

function AppContent() {
  const [showStyleGuide, setShowStyleGuide] = useState(false);
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
    <>
      {showStyleGuide ? <StyleGuide /> : <Chat />}

      {/* Only for development; remove when the style guide is no longer needed */}
      <button
        type="button"
        onClick={() => setShowStyleGuide((prev) => !prev)}
        className="fixed bottom-4 right-4 text-xs font-mono text-muted-foreground hover:text-foreground"
      >
        {showStyleGuide ? "Show Chat" : "Show Style Guide"}
      </button>
    </>
  );
}

function App() {
  return (
    <TooltipProvider>
      <DraftEditorProvider>
        <AppContent />
      </DraftEditorProvider>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}

export default App;
