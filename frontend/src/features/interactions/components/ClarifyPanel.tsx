import { useEffect, useRef, useState } from "react";
import { CornerDownLeft } from "lucide-react";

interface ClarifyPanelProps {
  question: string;
  options?: string[];
  isResolving: boolean;
  onSubmit: (value: string) => void;
}

export function ClarifyPanel({
  question,
  options = [],
  isResolving,
  onSubmit,
}: ClarifyPanelProps) {
  const [other, setOther] = useState("");
  const [isOtherActive, setIsOtherActive] = useState(options.length === 0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOtherActive) inputRef.current?.focus();
  }, [isOtherActive]);

  const submitOther = () => {
    if (other.trim()) onSubmit(other.trim());
  };

  return (
    <div className="w-full rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-sm">
      <p className="whitespace-pre-line px-2 pb-2 pt-1 text-sm font-medium">{question}</p>

      <div className="flex flex-col">
        {options.map((option, index) => (
          <button
            key={option}
            type="button"
            disabled={isResolving}
            onClick={() => onSubmit(option)}
            className="flex items-start gap-3 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent disabled:opacity-50"
          >
            <span className="w-4 shrink-0 text-muted-foreground">
              {index + 1}.
            </span>
            <span className="min-w-0 flex-1">{option}</span>
          </button>
        ))}

        <div
          className={`flex items-center gap-3 rounded-md px-2 py-1.5 text-sm ${
            isOtherActive ? "bg-accent" : "hover:bg-accent"
          }`}
          onClick={() => setIsOtherActive(true)}
        >
          <span className="w-4 shrink-0 text-muted-foreground">
            {options.length + 1}.
          </span>
          {isOtherActive ? (
            <>
              <input
                ref={inputRef}
                value={other}
                disabled={isResolving}
                onChange={(event) => setOther(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitOther();
                  } else if (event.key === "Escape" && options.length > 0) {
                    setIsOtherActive(false);
                    setOther("");
                  }
                }}
                placeholder="Type your answer..."
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
              />
              <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />
            </>
          ) : (
            <span className="text-muted-foreground">Other...</span>
          )}
        </div>
      </div>
    </div>
  );
}
