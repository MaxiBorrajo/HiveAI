import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";
import {
  BookOpen,
  Cog,
  Feather,
  Info,
  TriangleAlert,
  User,
} from "lucide-react";
import type { ChatMode, ChatModeParameter } from "../../types/chat.ts";
import { getModes } from "../../lib/modes/getModes.ts";
import { Button } from "../ui/button.tsx";
import { Switch } from "../ui/switch.tsx";
import { Slider } from "../ui/slider.tsx";
import { setMode } from "../../lib/modes/setMode.ts";
import { useModels } from "@/context/ModelsContext";

const iconForMode = (name: string) =>
  name === "light" ? (
    <Feather className="size-4" />
  ) : name === "full" ? (
    <BookOpen className="size-4" />
  ) : name === "custom" ? (
    <Cog className="size-4" />
  ) : (
    <User className="size-4" />
  );

export function ModesManager() {
  const { hasModel, modeResetSignal, runBusy } = useModels();
  const [modes, setModes] = useState<ChatMode[]>([]);
  const [currentMode, setCurrentMode] = useState<ChatMode>({
    name: "default",
    description: "Default mode with balanced performance",
    icon: <User className="size-4" />,
  });

  function refreshModes() {
    getModes().then(({ data }) => {
      if (!data) return;
      const withIcons = data.map((mode) => ({
        ...mode,
        icon: iconForMode(mode.name),
      }));
      setModes(withIcons);

      const active = withIcons.find((mode) => mode.isCurrent);
      if (active) setCurrentMode(active);
    });
  }

  useEffect(refreshModes, []);
  useEffect(() => {
    if (modeResetSignal) refreshModes();
  }, [modeResetSignal]);

  const changeModes = (
    mode: ChatMode,
    executeChange: (modesCopy: ChatMode[], modeIndex: number) => void,
  ) => {
    const modesCopy = [...modes];
    const modeIndex = modesCopy.findIndex((m) => m.name === mode.name);
    if (modeIndex !== -1) {
      executeChange(modesCopy, modeIndex);
      setModes(modesCopy);
    }
  };

  const reset = (mode: ChatMode) => () => {
    changeModes(mode, (modesCopy: ChatMode[], modeIndex: number) => {
      modesCopy[modeIndex].parameters?.forEach((parameter) => {
        parameter.currentValue = parameter.defaultValue;
      });
    });
  };

  const [isOpen, setIsOpen] = useState(false);

  const changeMode = async (mode: ChatMode) => {
    setIsOpen(false);
    await runBusy("Applying mode change...", async () => {
      try {
        await setMode(mode);
        refreshModes();
      } catch {}
    });
  };

  const onChange = (
    value: string | number | boolean,
    mode: ChatMode,
    parameter: ChatModeParameter,
  ) => {
    changeModes(mode, (modesCopy: ChatMode[], modeIndex: number) => {
      const parameterIndex = modesCopy[modeIndex].parameters?.findIndex(
        (p) => p.name === parameter.name,
      );
      if (parameterIndex !== undefined && parameterIndex !== -1) {
        modesCopy[modeIndex].parameters![parameterIndex].currentValue = value;
        setModes(modesCopy);
      }
    });
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger
        className="flex items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring px-1"
        title="Modes"
      >
        <ModeOption mode={currentMode} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={8}
        className="w-56"
      >
        <DropdownMenuGroup>
          <div className="px-1.5 py-1">
            <span className="text-sm font-medium">Mode</span>
          </div>

          <DropdownMenuSeparator />

          {modes.map((mode) => {
            return (
              <div key={mode.name} className="contents">
                {mode.parameters ? (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      disabled={!hasModel}
                      title={
                        hasModel
                          ? undefined
                          : "Select a model before switching modes"
                      }
                    >
                      <ModeOption mode={mode} />
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent sideOffset={10}>
                      {mode.performanceNote && (
                        <div className="flex w-0 min-w-full items-start gap-1.5 rounded-md bg-blue-500/10 p-2 text-xs text-blue-600 dark:text-blue-400">
                          <Info className="size-3.5 shrink-0 translate-y-0.5" />
                          <span>{mode.performanceNote}</span>
                        </div>
                      )}
                      {mode.parameters.map((parameter) => (
                        <div
                          key={`${mode.name}-${parameter.name}`}
                          className="px-1.5 py-1"
                        >
                          <ParameterOption
                            parameter={parameter}
                            mode={mode}
                            onChange={onChange}
                          />
                        </div>
                      ))}
                      <div className="flex flex-1 items-center justify-end gap-2 p-2">
                        <Button
                          onClick={reset(mode)}
                          title="Reset to defaults"
                          size="sm"
                          variant="secondary"
                        >
                          Reset
                        </Button>
                        <Button
                          onClick={() => changeMode(mode)}
                          title={
                            mode.parameters?.some(
                              (p) => p.requiresServiceRestart,
                            )
                              ? "Applying may restart the Ollama service if a parameter like kv_cache_type changed — this affects every model, not just this one, and may prompt for your password."
                              : "Apply the selected mode and its parameters"
                          }
                          size="sm"
                        >
                          Apply
                        </Button>
                      </div>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ) : (
                  <DropdownMenuItem
                    closeOnClick
                    onClick={() => changeMode(mode)}
                    title="Switching here may restart the Ollama service if a kv_cache_type override was active, clearing it back to Ollama's own default — this affects every model, not just this one, and may prompt for your password."
                  >
                    <ModeOption mode={mode} />
                  </DropdownMenuItem>
                )}
              </div>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ParameterOption({
  parameter,
  mode,
  onChange,
}: {
  parameter: ChatModeParameter;
  mode: ChatMode;
  onChange: (
    value: string | number | boolean,
    mode: ChatMode,
    parameter: ChatModeParameter,
  ) => void;
}) {
  const onChangeHandler = (value: string | number | boolean) => {
    onChange(value, mode, parameter);
  };

  return (
    <div
      className="flex flex-1 items-center gap-2 p-0.5"
      title={
        parameter.requiresServiceRestart
          ? `${parameter.description} Applying a change restarts the Ollama service, affecting every model.`
          : parameter.description
      }
    >
      <span className="text-sm font-mono truncate">{parameter.name}</span>
      {parameter.requiresServiceRestart && (
        <TriangleAlert className="size-3.5 shrink-0 text-amber-500" />
      )}
      {parameter.type === "boolean" && (
        <ParameterOptionBoolean
          parameter={parameter}
          onChange={onChangeHandler}
        ></ParameterOptionBoolean>
      )}
      {parameter.type === "string" && (
        <ParameterOptionString
          parameter={parameter}
          onChange={onChangeHandler}
        ></ParameterOptionString>
      )}
      {parameter.type === "number" && (
        <ParameterOptionNumber
          parameter={parameter}
          onChange={onChangeHandler}
        ></ParameterOptionNumber>
      )}
    </div>
  );
}

export function ParameterOptionBoolean({
  parameter,
  onChange,
}: {
  parameter: ChatModeParameter;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-end gap-2 p-0.5">
      <Switch
        checked={parameter.currentValue as boolean}
        onCheckedChange={onChange}
      />
    </div>
  );
}

export function ParameterOptionString({
  parameter,
  onChange,
}: {
  parameter: ChatModeParameter;
  onChange: (value: string) => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="ml-auto flex items-center justify-between min-w-20 px-2 h-8 rounded-md hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring outline-none">
        <span className="text-sm font-mono truncate">
          {parameter.currentValue as string}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {(parameter.options as string[])?.map((option) => (
          <DropdownMenuItem
            key={`${parameter.name}-${option}`}
            closeOnClick={false}
            onClick={() => onChange(option)}
          >
            <span className="text-sm font-mono truncate">{option}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function ParameterOptionNumber({
  parameter,
  onChange,
}: {
  parameter: ChatModeParameter;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-end gap-4 p-0.5 ml-4">
      <Slider
        min={parameter.minValue ?? 0}
        max={parameter.maxValue ?? 1}
        step={0.1}
        value={parameter.currentValue as number}
        onValueChange={(val) =>
          onChange(typeof val === "number" ? val : val[0])
        }
      />
      <span className="text-xs text-muted-foreground w-8 text-right tabular-nums">
        {parameter.currentValue as number}
      </span>
    </div>
  );
}

export function ModeOption({ mode }: { mode: ChatMode }) {
  return (
    <div
      className="flex flex-1 items-center gap-2 p-0.5"
      title={mode.description}
    >
      {mode.icon}
      <span className="text-sm font-mono truncate capitalize">{mode.name}</span>
      {mode.performanceNote && (
        <Info className="size-3.5 shrink-0 text-blue-500" />
      )}
    </div>
  );
}
