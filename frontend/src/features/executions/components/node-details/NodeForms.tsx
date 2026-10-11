import { useModels } from "@/features/models/ModelsContext";
import {
  buildProviderTree,
  canUse,
  isCloud,
  type ModelChoice,
} from "@/features/models/lib/modelChoices";
import type { ModelProvider } from "@/features/models/types";
import type { Plugin } from "@/features/plugins/types";
import { CONDITION_OPERATORS, RESULT_OUTPUT_TYPES } from "../../lib/graphOps";
import {
  Field,
  KeyValueEditor,
  Select,
  StateKeysDatalist,
  TextArea,
  TextInput,
} from "./fields";

export interface NodeFormProps {
  config: Record<string, any>;
  setConfig: (next: Record<string, any>) => void;
  stateKeys: string[];
  plugins: Plugin[];
}

const KEYS_LIST_ID = "node-form-state-keys";

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      String(v ?? ""),
    ]),
  );
}

export function LlmNodeForm({
  config,
  setConfig,
  stateKeys,
  plugins,
}: NodeFormProps) {
  const { optionGroups } = useModels();
  // Looked up with every model so a saved node whose model stopped qualifying
  // is explained; only usable models (and the one already set) are offered.
  const fullTree = buildProviderTree(optionGroups, { includeUnsupported: true });
  const tree = fullTree
    .map((e) => ({
      ...e,
      models: e.models.filter(
        (m) => canUse(m.toolSupport) || m.model === config.model,
      ),
    }))
    .filter((e) => e.models.length > 0);
  const provider: ModelProvider | "" = config.model
    ? (config.provider ?? "ollama")
    : "";
  const entry = tree.find((e) => e.provider === provider);
  const modelEntry = entry?.models.find((m) => m.model === config.model);
  const support = modelEntry?.toolSupport;
  const keyId: string = config.keyId ?? "";
  const modelKnown =
    !config.model ||
    (!!modelEntry &&
      (!isCloud(provider as ModelProvider) ||
        modelEntry.keys.some((k) => k.keyId === keyId)));

  const applyChoice = (choice: ModelChoice | null) => {
    const { provider: _p, keyId: _k, ...rest } = config;
    setConfig(
      !choice
        ? { ...rest, model: undefined }
        : isCloud(choice.provider)
          ? {
              ...rest,
              model: choice.model,
              provider: choice.provider,
              keyId: choice.keyId,
            }
          : { ...rest, model: choice.model },
    );
  };
  const pickProvider = (value: string) => {
    const next = tree.find((e) => e.provider === value);
    const first = next?.models.find((m) => canUse(m.toolSupport));
    applyChoice(
      next && first
        ? {
            provider: next.provider,
            model: first.model,
            keyId: first.keys[0]?.keyId ?? "",
          }
        : null,
    );
  };
  const pickModel = (value: string) => {
    const m = entry?.models.find((x) => x.model === value);
    if (!entry || !m) return;
    const keep = m.keys.find((k) => k.keyId === keyId);
    applyChoice({
      provider: entry.provider,
      model: m.model,
      keyId: keep?.keyId ?? m.keys[0]?.keyId ?? "",
    });
  };
  const pickKey = (value: string) => {
    if (!entry || !config.model) return;
    applyChoice({
      provider: entry.provider,
      model: config.model as string,
      keyId: value,
    });
  };
  const selectClass =
    "h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const set = (patch: Record<string, any>) =>
    setConfig({ ...config, ...patch });
  const equipped: string[] = Array.isArray(config.plugins)
    ? config.plugins
    : [];

  const togglePlugin = (name: string) =>
    set({
      plugins: equipped.includes(name)
        ? equipped.filter((p) => p !== name)
        : [...equipped, name],
    });

  return (
    <div className="flex flex-col gap-3">
      <StateKeysDatalist id={KEYS_LIST_ID} keys={stateKeys} />
      <Field
        label="Model"
        hint="Pick a provider, then a model, then the API key to use with it. Leave on default to use the model selected in the chat."
      >
        <div className="flex flex-col gap-1.5">
          <select
            value={provider}
            onChange={(e) => pickProvider(e.target.value)}
            className={selectClass}
          >
            <option value="">Default model</option>
            {provider && !entry && (
              <option value={provider}>{provider} (unavailable)</option>
            )}
            {tree.map((e) => (
              <option key={e.provider} value={e.provider}>
                {e.label}
              </option>
            ))}
          </select>
          {provider && (
            <select
              value={config.model ?? ""}
              onChange={(e) => pickModel(e.target.value)}
              className={selectClass}
            >
              {!modelEntry && (
                <option value={config.model}>
                  {config.model} (unavailable)
                </option>
              )}
              {entry?.models.map((m) => (
                <option key={m.model} value={m.model}>
                  {m.model}
                  {m.toolSupport?.status === "unsupported"
                    ? " (no tool support)"
                    : m.toolSupport?.status === "unknown"
                      ? " (tools unverified)"
                      : ""}
                </option>
              ))}
            </select>
          )}
          {isCloud(provider as ModelProvider) && (
            <select
              value={keyId}
              onChange={(e) => pickKey(e.target.value)}
              className={selectClass}
            >
              {!modelEntry?.keys.some((k) => k.keyId === keyId) && (
                <option value={keyId}>API key (unavailable)</option>
              )}
              {modelEntry?.keys.map((k) => (
                <option key={k.keyId} value={k.keyId}>
                  {k.alias}
                </option>
              ))}
            </select>
          )}
        </div>
        {modelKnown && support?.status === "unsupported" && (
          <p className="mt-1 text-[11px] text-destructive">
            This model cannot be used: {support.reason ?? "it does not support tool calling."}{" "}
            The execution will not start until you pick another one.
          </p>
        )}
        {modelKnown && support?.status === "unknown" && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Tool support of this model could not be verified.{" "}
            {support.reason}
          </p>
        )}
        {!modelKnown && (
          <p className="mt-1 text-[11px] text-destructive">
            This model or its API key no longer exists. The execution will not
            start until you pick another one.
          </p>
        )}
      </Field>
      <Field
        label="System prompt"
        hint='You can insert a state variable with ${name}, e.g. "Summarize: ${draft}". Plain names only (no ${a.b}).'
      >
        <TextArea
          value={config.systemPrompt ?? ""}
          onChange={(e) => set({ systemPrompt: e.target.value })}
          placeholder="What should this node do?"
        />
      </Field>
      <Field
        label="Output variable"
        hint="State variable where the answer is stored."
      >
        <TextInput
          value={config.outputKey ?? ""}
          onChange={(e) => set({ outputKey: e.target.value })}
        />
      </Field>
      <Field
        label="Inputs"
        hint="Variables this node can read: label → state variable."
      >
        <KeyValueEditor
          value={asStringRecord(config.inputMapping)}
          onChange={(inputMapping) => set({ inputMapping })}
          keyPlaceholder="label"
          valuePlaceholder="variable"
          valueListId={KEYS_LIST_ID}
        />
      </Field>
      <Field
        label="Tools"
        hint="With at least one plugin equipped this node behaves as an agent."
      >
        <div className="flex flex-col gap-1">
          {plugins.length === 0 && (
            <p className="text-[11px] text-muted-foreground">
              No active plugins.
            </p>
          )}
          {plugins.map((plugin) => (
            <label
              key={plugin.name}
              className="flex cursor-pointer items-center gap-2 text-xs"
            >
              <input
                type="checkbox"
                checked={equipped.includes(plugin.name)}
                onChange={() => togglePlugin(plugin.name)}
              />
              <span className="font-mono">{plugin.name}</span>
            </label>
          ))}
        </div>
      </Field>
    </div>
  );
}

export function PluginNodeForm({
  config,
  setConfig,
  stateKeys,
  plugins,
}: NodeFormProps) {
  const set = (patch: Record<string, any>) =>
    setConfig({ ...config, ...patch });
  const mapping = asStringRecord(config.inputMapping);
  const plugin = plugins.find((p) => p.name === config.pluginId);
  const parameters = plugin?.parameters ?? [];

  const setParam = (name: string, value: string) => {
    const next = { ...mapping };
    if (value === "") delete next[name];
    else next[name] = value;
    set({ inputMapping: next });
  };

  return (
    <div className="flex flex-col gap-3">
      <StateKeysDatalist id={KEYS_LIST_ID} keys={stateKeys} />
      <Field label="Plugin">
        <Select
          value={config.pluginId ?? ""}
          onChange={(pluginId) => set({ pluginId, inputMapping: {} })}
          placeholder="Select a plugin…"
          options={plugins.map((p) => ({ value: p.name }))}
        />
        {plugin?.description && (
          <p className="text-[10px] leading-snug text-muted-foreground">
            {plugin.description}
          </p>
        )}
      </Field>

      {plugin && parameters.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase text-muted-foreground">
            Parameters
          </span>
          {parameters.map((param) => (
            <Field
              key={param.name}
              label={`${param.name}${param.required ? " *" : ""}`}
              hint={param.description}
            >
              <TextInput
                value={mapping[param.name] ?? ""}
                placeholder="literal or ${variable}"
                onChange={(e) => setParam(param.name, e.target.value)}
              />
            </Field>
          ))}
          <p className="text-[10px] text-muted-foreground">
            Use {"${variable}"} to read a state variable. Paths like {"${a.b}"}{" "}
            are not supported.
          </p>
        </div>
      ) : plugin ? (
        <Field label="Parameters">
          <KeyValueEditor
            value={mapping}
            onChange={(inputMapping) => set({ inputMapping })}
            keyPlaceholder="parameter"
            valuePlaceholder="value"
          />
        </Field>
      ) : null}

      <Field label="Output variable">
        <TextInput
          value={config.outputKey ?? ""}
          onChange={(e) => set({ outputKey: e.target.value })}
        />
      </Field>
    </div>
  );
}

const NUMERIC_OPERATORS = new Set([
  "greater_than",
  "greater_than_or_equals",
  "less_than",
  "less_than_or_equals",
]);
const LIST_OPERATORS = new Set(["in", "not_in"]);
const NO_VALUE_OPERATORS = new Set(["is_empty", "is_not_empty"]);

function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  return value === undefined || value === null ? "" : String(value);
}

function parseValue(raw: string, operator: string): unknown {
  if (LIST_OPERATORS.has(operator)) {
    return raw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  if (
    NUMERIC_OPERATORS.has(operator) &&
    raw.trim() !== "" &&
    !Number.isNaN(Number(raw))
  ) {
    return Number(raw);
  }
  if (operator === "equals" || operator === "not_equals") {
    if (raw === "true") return true;
    if (raw === "false") return false;
  }
  return raw;
}

export function ConditionNodeForm({
  config,
  setConfig,
  stateKeys,
}: NodeFormProps) {
  const condition = config.condition ?? {
    field: "",
    operator: "equals",
    value: "",
  };
  const set = (patch: Record<string, unknown>) =>
    setConfig({ ...config, condition: { ...condition, ...patch } });

  return (
    <div className="flex flex-col gap-3">
      <StateKeysDatalist id={KEYS_LIST_ID} keys={stateKeys} />
      <Field
        label="Variable"
        hint="State variable to evaluate. Only here you can read inside an object with name.key (e.g. result.score)."
      >
        <TextInput
          list={KEYS_LIST_ID}
          value={condition.field ?? ""}
          onChange={(e) => set({ field: e.target.value })}
        />
      </Field>
      <Field label="Operator">
        <Select
          value={condition.operator}
          onChange={(operator) => {
            const raw = displayValue(condition.value);
            const value =
              NUMERIC_OPERATORS.has(operator) &&
              (raw === "" || Number.isNaN(Number(raw)))
                ? ""
                : parseValue(raw, operator);
            set({ operator, value });
          }}
          options={CONDITION_OPERATORS.map((o) => ({ value: o }))}
        />
      </Field>
      {!NO_VALUE_OPERATORS.has(condition.operator) && (
        <Field
          label="Value"
          hint={
            LIST_OPERATORS.has(condition.operator)
              ? "Comma separated list."
              : undefined
          }
        >
          <TextInput
            type={NUMERIC_OPERATORS.has(condition.operator) ? "number" : "text"}
            value={displayValue(condition.value)}
            onChange={(e) =>
              set({ value: parseValue(e.target.value, condition.operator) })
            }
          />
        </Field>
      )}
    </div>
  );
}

export function EndNodeForm({ config, setConfig, stateKeys }: NodeFormProps) {
  const output = config.output ?? {
    type: "markdown",
    summary: "",
    contentKey: "",
  };
  const set = (patch: Record<string, unknown>) =>
    setConfig({ ...config, output: { ...output, ...patch } });

  return (
    <div className="flex flex-col gap-3">
      <StateKeysDatalist id={KEYS_LIST_ID} keys={stateKeys} />
      <Field label="Result type">
        <Select
          value={output.type ?? "markdown"}
          onChange={(type) => set({ type })}
          options={RESULT_OUTPUT_TYPES.map((t) => ({ value: t }))}
        />
      </Field>
      <Field
        label="Result variable"
        hint="State variable whose value is delivered as the result."
      >
        <TextInput
          list={KEYS_LIST_ID}
          value={output.contentKey ?? ""}
          onChange={(e) => set({ contentKey: e.target.value })}
        />
      </Field>
      <Field label="Summary">
        <TextInput
          value={output.summary ?? ""}
          onChange={(e) => set({ summary: e.target.value })}
        />
      </Field>
    </div>
  );
}
