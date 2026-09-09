import { createContext, useContext, useState, type ReactNode } from "react";

// PluginsManager is mounted deep inside Chat/ChatInput, but the draft editor
// needs to render as its own full-screen page above everything (App-level),
// not nested inside the chat layout. A small context avoids prop-drilling
// the open/close handlers through every intermediate component — there's no
// router in this app to give the editor its own route instead (see
// App.tsx).
interface DraftEditorContextValue {
  openDraftName: string | null;
  openDraft: (name: string) => void;
  closeDraft: () => void;
  // Bumped every time a draft is successfully imported into a real plugin,
  // so PluginsManager (mounted elsewhere in the tree, unaware of the
  // full-screen editor) knows to refetch its plugin list.
  pluginsVersion: number;
  notifyPluginImported: () => void;
}

const DraftEditorContext = createContext<DraftEditorContextValue | null>(null);

export function DraftEditorProvider({ children }: { children: ReactNode }) {
  const [openDraftName, setOpenDraftName] = useState<string | null>(null);
  const [pluginsVersion, setPluginsVersion] = useState(0);

  return (
    <DraftEditorContext.Provider
      value={{
        openDraftName,
        openDraft: setOpenDraftName,
        closeDraft: () => setOpenDraftName(null),
        pluginsVersion,
        notifyPluginImported: () => setPluginsVersion((v) => v + 1),
      }}
    >
      {children}
    </DraftEditorContext.Provider>
  );
}

export function useDraftEditor(): DraftEditorContextValue {
  const ctx = useContext(DraftEditorContext);
  if (!ctx) {
    throw new Error("useDraftEditor must be used within a DraftEditorProvider");
  }
  return ctx;
}
