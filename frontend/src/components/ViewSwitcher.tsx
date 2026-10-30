import { MessageSquare, Workflow } from "lucide-react";

export type AppView = "chat" | "executions";

interface ViewSwitcherProps {
  currentView: AppView;
  onViewChange: (view: AppView) => void;
}

export function ViewSwitcher({ currentView, onViewChange }: ViewSwitcherProps) {
  return (
    <div className="flex items-center rounded-lg bg-card border p-0.5">
      <button
        type="button"
        onClick={() => onViewChange("chat")}
        className={`flex items-center justify-center p-1.5 rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          currentView === "chat"
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        }`}
        title="Chats"
      >
        <MessageSquare className="size-2.5" />
      </button>
      <button
        type="button"
        onClick={() => onViewChange("executions")}
        className={`flex items-center justify-center p-1.5 rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          currentView === "executions"
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        }`}
        title="Executions"
      >
        <Workflow className="size-2.5" />
      </button>
    </div>
  );
}
