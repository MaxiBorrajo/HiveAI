import { useState } from "react";
import { Plus, Trash2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "./ui/button.tsx";
import { ScrollArea } from "./ui/scroll-area.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";

function formatRelativeDate(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMinutes < 1) return "now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(timestamp).toLocaleDateString();
}

export interface SidebarItem {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AppSidebarProps {
  actions?: React.ReactNode;
  list: SidebarItem[];
  activeId: string | null;
  isLoading: boolean;
  selectItem: (itemId: string) => void;
  startNew: () => void;
  deleteItem: (itemId: string) => Promise<void>;
  unreadItemIds: Set<string>;
  sidebarTitle: string;
  entityName: string;
  loadingMessage?: string;
  newTitle?: string;
  emptyTitle?: string;
}

export function AppSidebar({
  actions,
  activeId,
  deleteItem,
  isLoading,
  list,
  selectItem,
  startNew,
  unreadItemIds,
  newTitle,
  entityName,
  sidebarTitle,
  loadingMessage,
  emptyTitle,
}: AppSidebarProps) {
  const [itemPendingDelete, setItemPendingDelete] =
    useState<SidebarItem | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  async function confirmDelete() {
    if (!itemPendingDelete) return;
    await deleteItem(itemPendingDelete.id);
    setItemPendingDelete(null);
  }

  if (isCollapsed) {
    return (
      <div className="flex h-screen w-12 shrink-0 flex-col items-center gap-2 border-r border-border bg-card py-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setIsCollapsed(false)}
          title="Open sidebar"
        >
          <PanelLeftOpen className="size-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={startNew}
          title={newTitle || "New"}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-64 shrink-0 flex-col border-r border-border bg-card p-3">
      <div className="flex items-center justify-between px-2">
        <span className="text-sm font-medium text-foreground">
          {sidebarTitle}
        </span>
        <div className="flex items-center gap-1">
          {actions}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={startNew}
            title={newTitle || "New"}
          >
            <Plus className="size-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setIsCollapsed(true)}
            title="Close sidebar"
          >
            <PanelLeftClose className="size-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0 mt-2">
        <div className="flex flex-col gap-0.5">
          {isLoading && list.length === 0 && (
            <p className="p-2 text-xs text-muted-foreground">
              {loadingMessage || "Loading..."}
            </p>
          )}

          {!isLoading && list.length === 0 && (
            <p className="p-2 text-xs text-muted-foreground">
              {emptyTitle || "Nothing yet"}
            </p>
          )}

          {list.map((item) => (
            <div
              key={item.id}
              className={`p-2 group flex items-center gap-2 rounded-lg text-sm cursor-pointer transition-colors ${
                item.id === activeId
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
              onClick={() => selectItem(item.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {unreadItemIds.has(item.id) && item.id !== activeId && (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-primary"
                      title="Unread response"
                    />
                  )}
                  <p className="truncate">{item.title || "New"}</p>
                </div>
                <p className="text-[10px] opacity-60">
                  {formatRelativeDate(item.updatedAt)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  setItemPendingDelete(item);
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>

      <Dialog
        open={!!itemPendingDelete}
        onOpenChange={(open) => !open && setItemPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {entityName}</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete
              {itemPendingDelete?.title
                ? ` "${itemPendingDelete?.title}"`
                : " this " + entityName.toLowerCase().trim()}
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setItemPendingDelete(null)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
