import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GraphEdge, GraphNode } from "../../types";
import { useActivePlugins } from "./usePlugins";
import { Field, TextInput } from "./fields";
import {
  ConditionNodeForm,
  EndNodeForm,
  LlmNodeForm,
  PluginNodeForm,
  type NodeFormProps,
} from "./NodeForms";

interface NodeDetailsPanelProps {
  node?: GraphNode;
  edge?: GraphEdge;
  stateKeys: string[];
  canEdit: boolean;
  onApply: (nodeId: string, patch: Pick<GraphNode, "name" | "config">) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
}

const LABEL = "text-[10px] text-muted-foreground uppercase font-semibold";
const CODE =
  "text-xs bg-muted/50 p-2 rounded border border-border/50 overflow-x-auto text-muted-foreground mt-1 break-all whitespace-pre-wrap";

const FORMS: Partial<Record<GraphNode["type"], (props: NodeFormProps) => React.ReactNode>> = {
  llm: LlmNodeForm,
  plugin: PluginNodeForm,
  condition: ConditionNodeForm,
  end: EndNodeForm,
};

function nodeKindLabel(node: GraphNode): string {
  const equipped = Array.isArray(node.config?.plugins) && node.config.plugins.length > 0;
  return node.type === "llm" && equipped ? "agent" : node.type;
}

export function NodeDetailsPanel({
  node,
  edge,
  stateKeys,
  canEdit,
  onApply,
  onDeleteNode,
  onDeleteEdge,
}: NodeDetailsPanelProps) {
  if (!node && !edge) return null;

  return (
    <div className="pointer-events-auto absolute left-6 top-6 flex max-h-[calc(100vh-200px)] w-80 flex-col gap-2 overflow-auto rounded-xl border border-border bg-background/95 p-4 shadow-lg backdrop-blur-sm">
      {node ? (
        <NodeBody
          key={node.id}
          node={node}
          stateKeys={stateKeys}
          canEdit={canEdit}
          onApply={onApply}
          onDelete={() => onDeleteNode(node.id)}
        />
      ) : (
        edge && <EdgeBody edge={edge} canEdit={canEdit} onDelete={() => onDeleteEdge(edge.id)} />
      )}
    </div>
  );
}

function NodeBody({
  node,
  stateKeys,
  canEdit,
  onApply,
  onDelete,
}: {
  node: GraphNode;
  stateKeys: string[];
  canEdit: boolean;
  onApply: NodeDetailsPanelProps["onApply"];
  onDelete: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(node.name);
  const [config, setConfig] = useState<Record<string, any>>(node.config ?? {});
  const plugins = useActivePlugins(isEditing);
  const Form = FORMS[node.type];

  const startEditing = () => {
    setName(node.name);
    setConfig(node.config ?? {});
    setIsEditing(true);
  };

  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Node Details</h3>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {nodeKindLabel(node)}
          </span>
          {canEdit && !isEditing && (
            <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]" onClick={startEditing}>
              <Pencil className="size-3" /> Edit
            </Button>
          )}
          {canEdit && !isEditing && (
            <Button
              size="sm"
              variant="destructive"
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={onDelete}
              title="Delete this node and its connections"
            >
              <Trash2 className="size-3" /> Delete
            </Button>
          )}
        </div>
      </div>

      {isEditing ? (
        <div className="flex flex-col gap-3">
          <Field label="Name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {Form ? (
            <Form config={config} setConfig={setConfig} stateKeys={stateKeys} plugins={plugins} />
          ) : (
            <p className="text-xs text-muted-foreground">This node has no configuration.</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onApply(node.id, { name: name.trim() || node.name, config });
                setIsEditing(false);
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className={LABEL}>ID</label>
            <p className="font-mono text-sm">{node.id}</p>
          </div>
          <div>
            <label className={LABEL}>Name</label>
            <p className="text-sm">{node.name}</p>
          </div>
          <div>
            <label className={LABEL}>Config</label>
            <pre className={CODE}>{JSON.stringify(node.config, null, 2)}</pre>
          </div>
        </div>
      )}
    </>
  );
}

function EdgeBody({ edge, canEdit, onDelete }: { edge: GraphEdge; canEdit: boolean; onDelete: () => void }) {
  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Edge Details</h3>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            edge
          </span>
          {canEdit && (
            <Button
              size="sm"
              variant="destructive"
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={onDelete}
              title="Delete this connection"
            >
              <Trash2 className="size-3" /> Delete
            </Button>
          )}
        </div>
      </div>
      <div className="space-y-3">
        <div>
          <label className={LABEL}>SOURCE ➔ TARGET</label>
          <p className="break-all font-mono text-sm">
            {edge.source} ➔ {edge.target}
          </p>
        </div>
        <div>
          <label className={LABEL}>IS CONDITIONAL</label>
          <p className="text-sm">{edge.isConditional ? "Yes" : "No"}</p>
        </div>
        {edge.path && (
          <div>
            <label className={LABEL}>BRANCH</label>
            <p className="text-sm">{edge.path}</p>
          </div>
        )}
        {edge.condition && (
          <div>
            <label className={LABEL}>CONDITION</label>
            <pre className={CODE}>{JSON.stringify(edge.condition, null, 2)}</pre>
          </div>
        )}
      </div>
    </>
  );
}
