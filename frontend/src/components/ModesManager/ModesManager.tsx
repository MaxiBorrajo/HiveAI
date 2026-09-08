import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";
import { Cog, Sparkles, User, Zap } from "lucide-react";
import type { ChatMode, ChatModeParameter } from "../../types/chat.ts";
import { getModes } from "../../lib/modes/getModes.ts";
import { Button } from "../ui/button.tsx";
import { Switch } from "../ui/switch.tsx";
import { Slider } from "../ui/slider.tsx";
import { setMode } from "../../lib/modes/setMode.ts";

export function ModesManager() {
  const [modes, setModes] = useState<ChatMode[]>([]);

  useEffect(() => {
    getModes().then(({ data }) => {
      setModes(
        data.map((mode) => ({
          ...mode,
          icon:
            mode.name === "fast" ? (
              <Zap className="size-4" />
            ) : mode.name === "quality" ? (
              <Sparkles className="size-4" />
            ) : mode.name === "custom" ? (
              <Cog className="size-4" />
            ) : (
              <User className="size-4" />
            ),
          name: mode.name.charAt(0).toUpperCase() + mode.name.slice(1),
        })),
      );
    });
  }, []);

  const [currentMode, setCurrentMode] = useState<ChatMode>({
    name: "Default",
    description: "Default mode with balanced performance",
    icon: <User className="size-4" />,
  });

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

  const changeMode = async (mode: ChatMode) => {
    setCurrentMode(mode);
    await setMode(mode);
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
    <DropdownMenu>
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
        {modes.map((mode) => {
          return (
            <>
              {mode.parameters ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <ModeOption mode={mode} />
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
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
                        title="Apply the selected mode and its parameters"
                        size="sm"
                      >
                        Apply
                      </Button>
                    </div>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : (
                <DropdownMenuItem
                  key={mode.name}
                  closeOnClick
                  onClick={() => setCurrentMode(mode)}
                >
                  <ModeOption mode={mode} />
                </DropdownMenuItem>
              )}
            </>
          );
        })}
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
      title={parameter.description}
    >
      <span className="text-sm font-mono truncate">{parameter.name}</span>
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
      <span className="text-sm font-mono truncate">{mode.name}</span>
    </div>
  );
}
