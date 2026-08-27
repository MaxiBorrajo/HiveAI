import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/logo/Logo";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { PluginList } from "@/components/PluginList";
import { sendMessage } from "@/lib/send-message";
import type { Message } from "@/types/chat";

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [selectedPluginIds, setSelectedPluginIds] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  function togglePlugin(id: string) {
    setSelectedPluginIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }

  async function handleSend() {
    const content = input.trim();
    if (!content || isThinking) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
    };

    const nextHistory = [...messages, userMessage];
    setMessages(nextHistory);
    setInput("");
    setIsThinking(true);

    try {
      const reply = await sendMessage(nextHistory, content, selectedPluginIds);
      setMessages((prev) => [...prev, reply]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "agent",
          content:
            error instanceof Error
              ? `No se pudo obtener respuesta: ${error.message}`
              : "No se pudo obtener respuesta del agente.",
          isError: true,
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex h-screen bg-background text-foreground font-sans overflow-hidden">
      <div className="flex flex-1 flex-col min-w-0 min-h-0">
        <header className="flex h-16 items-center gap-3 border-b border-border px-6">
          <Logo size={28} withWordmark />
        </header>

        <ScrollArea className="flex-1 min-h-0 **:data-[slot=scroll-area-thumb]:bg-muted-foreground/30 **:data-[slot=scroll-area-thumb]:hover:bg-muted-foreground/50 **:data-[slot=scroll-area-thumb]:transition-colors">
          <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
            {messages.length === 0 && (
              <p className="text-muted-foreground text-sm">
                Preguntale algo a HiveQueen para empezar.
              </p>
            )}

            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}

            {isThinking && (
              <div className="flex items-center gap-3">
                <Avatar>
                  <AvatarFallback className="bg-primary/20 text-primary">
                    HQ
                  </AvatarFallback>
                </Avatar>
                <Skeleton className="h-4 w-48" />
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        <div className="border-t border-border px-6 py-4">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Escribí un mensaje al agente..."
              className="resize-none text-base"
              rows={2}
            />
            <Button
              onClick={handleSend}
              disabled={isThinking || !input.trim()}
            >
              Enviar
            </Button>
          </div>
        </div>
      </div>

      <PluginList selectedIds={selectedPluginIds} onToggle={togglePlugin} />
    </div>
  );
}

function ChatMessage({ message }: { message: Message }) {
  const isAgent = message.role === "agent";

  const bubble = (
    <div
      className={`max-w-[75%] rounded-lg px-4 py-2 text-sm ${
        message.isError
          ? "bg-destructive/10 text-destructive border border-destructive/40"
          : isAgent
            ? "bg-card text-card-foreground border border-border"
            : "bg-primary/10 text-foreground"
      }`}
    >
      {message.content}
    </div>
  );

  const avatar = (
    <Avatar>
      <AvatarFallback
        className={
          isAgent
            ? "bg-primary/20 text-primary"
            : "bg-secondary text-secondary-foreground"
        }
      >
        {isAgent ? "HQ" : "Vos"}
      </AvatarFallback>
    </Avatar>
  );

  return (
    <div
      className={`flex items-center gap-3 ${isAgent ? "flex-row" : "flex-row-reverse"}`}
    >
      {avatar}
      {bubble}
    </div>
  );
}
