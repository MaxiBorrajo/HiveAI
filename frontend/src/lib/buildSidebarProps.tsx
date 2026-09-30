import { Pencil, Trash2 } from "lucide-react";
import type { AppSidebarProps, SidebarItem } from "@/components/AppSidebar";

export interface DeleteTarget {
  id: string;
  title?: string;
  entityName: string;
  onConfirm: () => Promise<void>;
}

export interface RenameTarget {
  id: string;
  title?: string;
  entityName: string;
  onConfirm: (newTitle: string) => Promise<void>;
}

export interface SidebarEntityConfig<TItem extends { id: string; updatedAt: number; createdAt: number }> {
  entityName: string;
  sidebarTitle: string;
  loadingMessage: string;
  newTitle: string;
  emptyTitle: string;
  items: TItem[];
  toSidebarItem: (item: TItem) => SidebarItem;
  activeId: string | null;
  isLoading: boolean;
  unreadItemIds?: Set<string>;
  selectItem: (id: string) => void;
  startNew: () => void;
  deleteItem: (id: string) => Promise<void>;
  renameItem: (id: string, newTitle: string) => Promise<void>;
}

/**
 * Builds an AppSidebar props object for one entity list (chats,
 * executions, ...). Both call sites in App.tsx used to hand-build this same
 * shape — same SidebarItem mapping, same Rename/Delete menu options wired
 * to setRenameTarget/setDeleteTarget — with only the entity's own labels
 * and CRUD functions differing.
 */
export function buildSidebarProps<
  TItem extends { id: string; updatedAt: number; createdAt: number },
>(
  config: SidebarEntityConfig<TItem>,
  setDeleteTarget: (target: DeleteTarget | null) => void,
  setRenameTarget: (target: RenameTarget | null) => void,
): Omit<AppSidebarProps, "actions"> {
  return {
    list: config.items.map(config.toSidebarItem),
    activeId: config.activeId,
    isLoading: config.isLoading,
    selectItem: config.selectItem,
    startNew: config.startNew,
    deleteItem: config.deleteItem,
    unreadItemIds: config.unreadItemIds ?? new Set<string>(),
    sidebarTitle: config.sidebarTitle,
    entityName: config.entityName,
    loadingMessage: config.loadingMessage,
    newTitle: config.newTitle,
    emptyTitle: config.emptyTitle,
    itemMenuOptions: [
      {
        label: "Rename",
        icon: <Pencil className="size-3.5" />,
        onClick: (item: SidebarItem) => {
          setRenameTarget({
            id: item.id,
            title: item.title,
            entityName: config.entityName,
            onConfirm: async (newTitle: string) => {
              await config.renameItem(item.id, newTitle);
            },
          });
        },
      },
      {
        label: "Delete",
        icon: <Trash2 className="size-3.5" />,
        variant: "destructive" as const,
        onClick: (item: SidebarItem) => {
          setDeleteTarget({
            id: item.id,
            title: item.title,
            entityName: config.entityName,
            onConfirm: async () => {
              await config.deleteItem(item.id);
            },
          });
        },
      },
    ],
  };
}
