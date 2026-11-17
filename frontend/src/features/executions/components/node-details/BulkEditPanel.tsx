import { useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GraphNode } from "../../types";
import {
  bulkEditable,
  equippedPlugins,
  isEmptyEdit,
  modelOf,
  sameModel,
  shared,
  type BulkEdit,
} from "../../lib/bulkEdit";
import { useInstalledPlugins } from "./usePlugins";
import { Field, TextInput } from "./fields";
import { ModelField } from "./NodeForms";

interface BulkEditPanelProps {
  nodes: GraphNode[];
  canEdit: boolean;
  onApply: (nodeIds: string[], edit: BulkEdit) => void;
  onDelete: (nodeIds: string[]) => void;
  onClearSelection: () => void;
}

/** Settings shared by several selected nodes, changed for all of them at once. */
export function BulkEditPanel({ nodes, canEdit, onApply, onDelete, onClearSelection }: BulkEditPanelProps) {
  const [edit, setEdit] = useState<BulkEdit>({});
  const plugins = useInstalledPlugins(true);
  const llmNodes = bulkEditable(nodes);
  const others = nodes.length - llmNodes.length;

  const set = (patch: BulkEdit) => setEdit((prev) => ({ ...prev, ...patch }));
  const unset = (field: keyof BulkEdit) =>
    setEdit(({ [field]: _dropped, ...rest }) => rest);

  return (
    <div className="pointer-events-auto absolute left-6 top-6 flex max-h-[calc(100vh-200px)] w-80 flex-col gap-2 overflow-auto rounded-xl border border-border bg-background/95 p-4 shadow-lg backdrop-blur-sm">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">{nodes.length} nodes selected</h3>
        <button
          type="button"
          onClick={onClearSelection}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Clear selection"
          title="Clear selection"
        >
          <X className="size-4" />
        </button>
      </div>

      <ul className="flex max-h-20 flex-wrap gap-1 overflow-y-auto">
        {nodes.map((n) => (
          <li
            key={n.id}
            className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground"
            title={n.id}
          >
            {n.name}
          </li>
        ))}
      </ul>

      {llmNodes.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          None of these is an LLM or agent node, so there are no settings to change together.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[11px] leading-snug text-muted-foreground">
            Changes apply to the {llmNodes.length} LLM and agent node{llmNodes.length === 1 ? "" : "s"}
            {others > 0 ? ` (the other ${others} stay as they are)` : ""}. Prompts, inputs and outputs are
            still edited one node at a time.
          </p>
          <SharedModel nodes={llmNodes} edit={edit} set={set} unset={unset} />
          <SharedMaxTokens nodes={llmNodes} edit={edit} set={set} unset={unset} />
          <Field label="Tools" hint="A dash means only some of the nodes have it; leave it to keep each node as it is.">
            <div className="flex flex-col gap-1">
              {plugins.length === 0 && <p className="text-[11px] text-muted-foreground">No plugins installed.</p>}
              {plugins.map((plugin) => {
                const holders = llmNodes.filter((n) => equippedPlugins(n.config).includes(plugin.name)).length;
                const chosen = edit.plugins?.[plugin.name];
                return (
                  <TriStateCheckbox
                    key={plugin.name}
                    label={plugin.name}
                    checked={chosen ?? holders === llmNodes.length}
                    indeterminate={chosen === undefined && holders > 0 && holders < llmNodes.length}
                    onChange={(on) => set({ plugins: { ...edit.plugins, [plugin.name]: on } })}
                  />
                );
              })}
            </div>
          </Field>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <Button
          size="sm"
          variant="destructive"
          className="gap-1"
          disabled={!canEdit}
          onClick={() => onDelete(nodes.map((n) => n.id))}
          title="Delete these nodes and their connections"
        >
          <Trash2 className="size-3" /> Delete {nodes.length}
        </Button>
        {llmNodes.length > 0 && (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={isEmptyEdit(edit)} onClick={() => setEdit({})}>
              Reset
            </Button>
            <Button
              size="sm"
              disabled={!canEdit || isEmptyEdit(edit)}
              onClick={() => {
                onApply(llmNodes.map((n) => n.id), edit);
                setEdit({});
              }}
            >
              Apply to {llmNodes.length}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

interface SharedFieldProps {
  nodes: GraphNode[];
  edit: BulkEdit;
  set: (patch: BulkEdit) => void;
  unset: (field: keyof BulkEdit) => void;
}

function SharedModel({ nodes, edit, set, unset }: SharedFieldProps) {
  const current = shared(nodes.map((n) => modelOf(n.config)), sameModel);
  const mixed = edit.model === undefined && current.mixed;
  const shown = edit.model !== undefined ? edit.model : current.mixed ? null : current.value;

  return (
    <ModelField
      config={shown ?? {}}
      setConfig={(next) => set({ model: modelOf(next) })}
      mixed={mixed}
      keepEach={current.mixed ? () => unset("model") : undefined}
    />
  );
}

function SharedMaxTokens({ nodes, edit, set, unset }: SharedFieldProps) {
  const current = shared(nodes.map((n) => (n.config?.maxTokens as number | undefined) ?? null));
  const shown = edit.maxTokens !== undefined ? edit.maxTokens : current.mixed ? null : current.value;

  return (
    <Field label="Max output tokens" hint="Leave empty for the model default.">
      <TextInput
        type="number"
        min={1}
        value={shown ?? ""}
        placeholder={current.mixed && edit.maxTokens === undefined ? "Different values, kept as they are" : ""}
        onChange={(e) => {
          if (e.target.value) set({ maxTokens: Number(e.target.value) });
          // Emptied: with differing values that means "keep each one", otherwise "model default".
          else if (current.mixed || current.value === null) unset("maxTokens");
          else set({ maxTokens: null });
        }}
      />
    </Field>
  );
}

function TriStateCheckbox({
  label,
  checked,
  indeterminate,
  onChange,
}: {
  label: string;
  checked: boolean;
  indeterminate: boolean;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs">
      <input
        ref={ref}
        type="checkbox"
        checked={checked && !indeterminate}
        // A partly equipped tool goes to "everyone has it" on the first click.
        onChange={() => onChange(indeterminate ? true : !checked)}
      />
      <span className="font-mono">{label}</span>
    </label>
  );
}
