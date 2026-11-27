import { createContext, useContext, useState, type ReactNode } from "react";

export type PluginKind = "draft" | "official";

export interface OpenPlugin {
  name: string;
  /** A draft is still being built; an official plugin is installed. */
  kind: PluginKind;
  /** Open straight in edit mode (e.g. right after moving a plugin to drafts). */
  startInEdit?: boolean;
}

interface DraftEditorContextValue {
  openPlugin: OpenPlugin | null;
  /** Opens the plugin editor (view mode unless `startInEdit`). */
  openEditor: (plugin: OpenPlugin) => void;
  /** Shortcut for opening a draft. */
  openDraft: (name: string) => void;
  closeDraft: () => void;
  pluginsVersion: number;
  notifyPluginImported: () => void;
}

const DraftEditorContext = createContext<DraftEditorContextValue | null>(null);

export function DraftEditorProvider({ children }: { children: ReactNode }) {
  const [openPlugin, setOpenPlugin] = useState<OpenPlugin | null>(null);
  const [pluginsVersion, setPluginsVersion] = useState(0);

  return (
    <DraftEditorContext.Provider
      value={{
        openPlugin,
        openEditor: setOpenPlugin,
        openDraft: (name) => setOpenPlugin({ name, kind: "draft" }),
        closeDraft: () => setOpenPlugin(null),
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
