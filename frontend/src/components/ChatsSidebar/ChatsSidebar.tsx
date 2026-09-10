import { useState } from "react";
import {
  Plus,
  MessageSquare,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { Button } from "../ui/button.tsx";
import { ScrollArea } from "../ui/scroll-area.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.tsx";
import { useChats } from "../../context/ChatsContext.tsx";
import type { ChatSummary } from "../../types/chat.ts";

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

export function ChatsSidebar() {
  const { chats, activeChatId, isLoadingChats, selectChat, startNewChat, deleteChat } =
    useChats();
  const [chatPendingDelete, setChatPendingDelete] = useState<ChatSummary | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  async function confirmDelete() {
    if (!chatPendingDelete) return;
    await deleteChat(chatPendingDelete.id);
    setChatPendingDelete(null);
  }

  if (isCollapsed) {
    return (
      <div className="flex h-screen w-12 shrink-0 flex-col items-center gap-2 border-r border-border bg-card py-3">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon-sm" onClick={() => setIsCollapsed(false)} />
            }
          >
            <PanelLeftOpen className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="right">Open sidebar</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-sm" onClick={startNewChat} />}
          >
            <Plus className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="right">New chat</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-64 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex items-center justify-between px-3 pt-3">
        <span className="text-sm font-medium text-foreground">Chats</span>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={<Button variant="ghost" size="icon-sm" onClick={startNewChat} />}
            >
              <Plus className="size-4" />
            </TooltipTrigger>
            <TooltipContent side="bottom">New chat</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" onClick={() => setIsCollapsed(true)} />
              }
            >
              <PanelLeftClose className="size-4" />
            </TooltipTrigger>
            <TooltipContent side="bottom">Close sidebar</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0 mt-2">
        <div className="flex flex-col gap-0.5 px-2 pb-3">
          {isLoadingChats && chats.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              Loading chats...
            </p>
          )}

          {!isLoadingChats && chats.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              No chats yet
            </p>
          )}

          {chats.map((chat) => (
            <div
              key={chat.id}
              className={`group flex items-center gap-2 rounded-lg px-2 py-2 text-sm cursor-pointer transition-colors ${
                chat.id === activeChatId
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
              onClick={() => selectChat(chat.id)}
            >
              <MessageSquare className="size-4 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="truncate">{chat.title || "New chat"}</p>
                <p className="text-[10px] opacity-60">
                  {formatRelativeDate(chat.updatedAt)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  setChatPendingDelete(chat);
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>

      <Dialog
        open={!!chatPendingDelete}
        onOpenChange={(open) => !open && setChatPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete chat</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{chatPendingDelete?.title || "this chat"}
              "? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChatPendingDelete(null)}>
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
