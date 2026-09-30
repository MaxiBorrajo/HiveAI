import { useState } from "react";
import {
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  EllipsisVertical,
} from "lucide-react";
import { Button } from "./ui/button.tsx";
import { ScrollArea } from "./ui/scroll-area.tsx";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/dropdown-menu.tsx";

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

export interface SidebarMenuOption {
  label: string;
  icon?: React.ReactNode;
  variant?: "default" | "destructive";
  onClick: (item: SidebarItem) => void;
}

export interface AppSidebarProps {
  actions?: React.ReactNode;
  list: SidebarItem[];
  activeId: string | null;
  isLoading: boolean;
  selectItem: (itemId: string) => void;
  startNew: () => void;
  deleteItem?: (itemId: string) => Promise<void>;
  unreadItemIds: Set<string>;
  sidebarTitle: string;
  entityName: string;
  loadingMessage?: string;
  newTitle?: string;
  emptyTitle?: string;
  itemMenuOptions?:
    | SidebarMenuOption[]
    | ((item: SidebarItem) => SidebarMenuOption[]);
}

export function AppSidebar({
  actions,
  activeId,
  isLoading,
  list,
  selectItem,
  startNew,
  unreadItemIds,
  newTitle,
  sidebarTitle,
  loadingMessage,
  emptyTitle,
  itemMenuOptions,
}: AppSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

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

          {list.map((item) => {
            const options =
              typeof itemMenuOptions === "function"
                ? itemMenuOptions(item)
                : itemMenuOptions;

            return (
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

                {options && options.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="flex items-center justify-center size-6 rounded-md hover:bg-background/80 hover:text-foreground opacity-0 group-hover:opacity-100 data-popup-open:opacity-100 data-open:opacity-100 focus-visible:opacity-100 outline-none transition-opacity shrink-0"
                      onClick={(e) => e.stopPropagation()}
                      title="More options"
                    >
                      <EllipsisVertical className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      side="bottom"
                      sideOffset={4}
                      className="w-32"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {options.map((option, index) => (
                        <DropdownMenuItem
                          key={index}
                          variant={option.variant}
                          onClick={(e) => {
                            e.stopPropagation();
                            option.onClick(item);
                          }}
                          className="flex items-center gap-2"
                        >
                          {option.icon}
                          <span>{option.label}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
