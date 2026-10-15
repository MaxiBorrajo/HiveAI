import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu.tsx";
import { SlidersHorizontal, TriangleAlert } from "lucide-react";
import type { ModelSetting, ModelSettingValue } from "../types.ts";
import { getModelSettings } from "../api/getModelSettings.ts";
import { setModelSettings } from "../api/setModelSettings.ts";
import { Button } from "../../../components/ui/button.tsx";
import { Switch } from "../../../components/ui/switch.tsx";
import { Slider } from "../../../components/ui/slider.tsx";
import { useModels } from "@/features/models/ModelsContext";

const THINKING_SETTING = "thinking";

export function ModelSettingsMenu() {
  const { runBusy } = useModels();
  const [settings, setSettings] = useState<ModelSetting[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  function refresh() {
    getModelSettings().then(({ data }) => {
      if (data) setSettings(data);
    });
  }

  useEffect(refresh, []);

  const onChange = (name: string, value: ModelSettingValue) => {
    setSettings((prev) =>
      prev.map((s) => (s.name === name ? { ...s, currentValue: value } : s)),
    );
  };

  const reset = () => {
    setSettings((prev) =>
      prev.map((s) =>
        s.name === THINKING_SETTING
          ? s
          : { ...s, currentValue: s.defaultValue },
      ),
    );
  };

  const apply = async () => {
    setIsOpen(false);
    const values = Object.fromEntries(
      settings.map((s) => [s.name, s.currentValue]),
    );
    await runBusy("Applying model settings...", async () => {
      try {
        await setModelSettings(values);
      } catch {}
      refresh();
    });
  };

  const visible = settings.filter((s) => s.name !== THINKING_SETTING);
  const groups = [
    {
      title: "Per request",
      items: visible.filter((s) => !s.requiresServiceRestart),
    },
    {
      title: "Ollama server (restarts Ollama)",
      items: visible.filter((s) => s.requiresServiceRestart),
    },
  ].filter((group) => group.items.length > 0);

  return (
    <DropdownMenu
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (open) refresh();
      }}
    >
      <DropdownMenuTrigger
        className="flex items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring px-1"
        title="Model settings"
      >
        <div className="flex items-center gap-2 p-0.5">
          <SlidersHorizontal className="size-4" />
          <span className="text-sm font-mono">Settings</span>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={8}
        className="w-80 max-h-[min(32rem,var(--available-height))]"
      >
        <DropdownMenuGroup>
          {groups.map((group) => (
            <div key={group.title}>
              <div className="px-1.5 pt-2 text-xs font-medium text-muted-foreground">
                {group.title}
              </div>
              {group.items.map((setting) => (
                <div key={setting.name} className="px-1.5 py-1">
                  <SettingRow setting={setting} onChange={onChange} />
                </div>
              ))}
            </div>
          ))}
          <div className="flex flex-1 items-center justify-end gap-2 p-2">
            <Button
              onClick={reset}
              title="Reset to defaults"
              size="sm"
              variant="secondary"
            >
              Reset
            </Button>
            <Button
              onClick={apply}
              title="Applying may restart the Ollama service if a server setting like kv_cache_type changed — this affects every model, not just this one, and may prompt for your password."
              size="sm"
            >
              Apply
            </Button>
          </div>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SettingRow({
  setting,
  onChange,
}: {
  setting: ModelSetting;
  onChange: (name: string, value: ModelSettingValue) => void;
}) {
  const change = (value: ModelSettingValue) => onChange(setting.name, value);

  return (
    <div
      className="flex flex-1 items-center gap-2 p-0.5"
      title={[setting.description, setting.note].filter(Boolean).join(" ")}
    >
      <span className="text-sm font-mono truncate">{setting.name}</span>
      {setting.requiresServiceRestart && (
        <TriangleAlert className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      {setting.type === "boolean" && (
        <div className="flex flex-1 items-center justify-end p-0.5">
          <Switch
            checked={setting.currentValue as boolean}
            onCheckedChange={change}
          />
        </div>
      )}
      {setting.type === "string" && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="ml-auto flex items-center justify-between min-w-20 px-2 h-8 rounded-md hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring outline-none">
            <span className="text-sm font-mono truncate">
              {setting.currentValue as string}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {setting.options?.map((option) => (
              <DropdownMenuItem
                key={`${setting.name}-${option}`}
                closeOnClick={false}
                onClick={() => change(option)}
              >
                <span className="text-sm font-mono truncate">{option}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      {setting.type === "number" && (
        <div className="flex flex-1 items-center justify-end gap-4 p-0.5 ml-4">
          <Slider
            min={setting.minValue ?? 0}
            max={setting.maxValue ?? 1}
            step={setting.step ?? 1}
            value={(setting.currentValue as number | null) ?? setting.minValue ?? 0}
            onValueChange={(val) => change(typeof val === "number" ? val : val[0])}
          />
          <span className="text-xs text-muted-foreground w-10 text-right tabular-nums">
            {setting.currentValue ?? "auto"}
          </span>
        </div>
      )}
    </div>
  );
}
