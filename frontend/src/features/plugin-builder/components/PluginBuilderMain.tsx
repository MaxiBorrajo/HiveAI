import { useState } from "react";
import { usePluginBuilderWorkspace } from "../hooks/usePluginBuilderWorkspace";
import { PluginBuilderChatPanel } from "./PluginBuilderChatPanel";
import { PluginCodePanel } from "./PluginCodePanel";
import { InstallBar } from "./InstallBar";
import { reportError, reportSuccess } from "@/lib/toastManager";

export function PluginBuilderMain() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [newSessionToken] = useState(() => crypto.randomUUID());
  const [input, setInput] = useState("");

  const key = sessionId || newSessionToken;

  const {
    isThinking,
    draft,
    sourceCode,
    activity,
    qualityReport,
    testResults,
    isInstalling,
    handleGenerate,
    handleStop,
    handleRunTest,
    handleInstall,
    handleDiscard,
  } = usePluginBuilderWorkspace({
    key,
    sessionId,
    onSessionCreated: setSessionId,
  });

  const isEmpty = !draft && !isThinking;

  const handleSend = () => {
    if (!input.trim() || isThinking) return;
    const prompt = input;
    setInput("");
    handleGenerate(prompt);
  };

  const handleInstallClick = async () => {
    const result = await handleInstall();
    if (result.success) {
      reportSuccess("Plugin installed", `"${result.name}" is now active.`);
      setSessionId(null);
      setInput("");
    } else {
      reportError([result.error ?? "Could not install the plugin."]);
    }
  };

  const handleDiscardClick = async () => {
    await handleDiscard();
    setSessionId(null);
    setInput("");
  };

  return (
    <div className="flex h-full min-h-0 w-full">
      <div className="flex min-h-0 w-full max-w-xl flex-col border-r border-border">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <PluginBuilderChatPanel
            input={input}
            setInput={setInput}
            isThinking={isThinking}
            isEmpty={isEmpty}
            activity={activity}
            onSend={handleSend}
            onStop={handleStop}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {draft && sourceCode ? (
          <>
            <div className="min-h-0 flex-1">
              <PluginCodePanel
                draft={draft}
                sourceCode={sourceCode}
                qualityReport={qualityReport}
                testResults={testResults}
                onRunTest={handleRunTest}
              />
            </div>
            <InstallBar
              qualityReport={qualityReport}
              isInstalling={isInstalling}
              onInstall={handleInstallClick}
              onDiscard={handleDiscardClick}
            />
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Describe the plugin you want in the chat to get started.
          </div>
        )}
      </div>
    </div>
  );
}
