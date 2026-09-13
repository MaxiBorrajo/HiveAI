import { createContext, useContext, useState, type ReactNode } from "react";

interface DraftEditorContextValue {
  openDraftName: string | null;
  openDraft: (name: string) => void;
  closeDraft: () => void;
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
