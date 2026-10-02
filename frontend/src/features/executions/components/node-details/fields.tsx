import type { ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-[10px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function TextInput(props: React.ComponentProps<typeof Input>) {
  return <Input {...props} className="h-8 text-xs" />;
}

export function TextArea(props: React.ComponentProps<typeof Textarea>) {
  return <Textarea {...props} className="min-h-24 text-xs" />;
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label?: string }[];
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label ?? o.value}
        </option>
      ))}
    </select>
  );
}

export function StateKeysDatalist({ id, keys }: { id: string; keys: string[] }) {
  return (
    <datalist id={id}>
      {keys.map((k) => (
        <option key={k} value={k} />
      ))}
    </datalist>
  );
}

export function KeyValueEditor({
  value,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  valueListId,
}: {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  valueListId?: string;
}) {
  const entries = Object.entries(value);
  const rename = (oldKey: string, newKey: string) => {
    const next: Record<string, string> = {};
    for (const [k, v] of entries) next[k === oldKey ? newKey : k] = v;
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {entries.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-1.5">
          <TextInput value={k} placeholder={keyPlaceholder} onChange={(e) => rename(k, e.target.value)} />
          <TextInput
            value={v}
            list={valueListId}
            placeholder={valuePlaceholder}
            onChange={(e) => onChange({ ...value, [k]: e.target.value })}
          />
          <button
            type="button"
            onClick={() => {
              const { [k]: _removed, ...rest } = value;
              onChange(rest);
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange({ ...value, [`key_${entries.length + 1}`]: "" })}
        className="flex w-fit items-center gap-1 text-[11px] text-primary hover:underline"
      >
        <Plus className="size-3" /> Add
      </button>
    </div>
  );
}
