import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatInputProps {
  input: string;
  setInput: (val: string) => void;
  isThinking: boolean;
  handleSend: () => void;
}

export function ChatInput({ input, setInput, isThinking, handleSend }: ChatInputProps) {
  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="relative flex w-full max-w-3xl flex-col rounded-xl border border-border bg-card p-3 shadow-sm focus-within:ring-1 focus-within:ring-ring">
      <Textarea
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Escribí un mensaje al agente..."
        className="min-h-[56px] w-full resize-none border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0 placeholder:text-muted-foreground"
        rows={2}
      />
      <div className="mt-2 flex items-center justify-between">
        <div className="flex gap-2">
          {/* Espacio para futuros botones (ej: adjuntos, selector de modelo) */}
        </div>
        <Button
          onClick={handleSend}
          disabled={isThinking || !input.trim()}
          size="sm"
        >
          Enviar
        </Button>
      </div>
    </div>
  );
}
