import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

export function StyleGuide() {
  return (
    <div className="min-h-screen bg-background text-foreground p-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-12">
        {/* Cabecera / Logo */}
        <section className="space-y-4">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="HiveAI" width={48} height={48} />
            <span
              className="text-display text-lg"
              style={{ fontStretch: "118%" }}
            >
              Hive<span className="text-primary">AI</span>
            </span>
          </div>
          <p className="text-muted-foreground text-sm">
            HiveAI — Style & Component Guide
          </p>
        </section>

        <Separator />

        {/* Colores */}
        <section className="space-y-4">
          <h2 className="text-display text-lg">Semantic Colors</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <ColorSwatch
              name="Background"
              className="bg-background border-border"
              text="text-foreground"
            />
            <ColorSwatch
              name="Card"
              className="bg-card border-border"
              text="text-card-foreground"
            />
            <ColorSwatch
              name="Primary (Agent)"
              className="bg-primary border-none"
              text="text-primary-foreground"
            />
            <ColorSwatch
              name="Destructive (Error)"
              className="bg-destructive border-none"
              text="text-destructive-foreground"
            />
            <ColorSwatch
              name="Muted"
              className="bg-muted border-none"
              text="text-muted-foreground"
            />
            <ColorSwatch
              name="Secondary"
              className="bg-secondary border-none"
              text="text-secondary-foreground"
            />
            <ColorSwatch
              name="Accent"
              className="bg-accent border-none"
              text="text-accent-foreground"
            />
            <ColorSwatch
              name="Border"
              className="bg-border border-none"
              text="text-foreground"
            />
          </div>
        </section>

        <Separator />

        {/* Tipografía */}
        <section className="space-y-4">
          <h2 className="text-display text-lg">Typography</h2>
          <div className="space-y-4 bg-card p-6 rounded-lg border border-border">
            <div>
              <p className="text-display text-lg">.text-display text-lg</p>
              <p className="text-muted-foreground text-xs font-mono">
                Used for wordmark and section titles.
              </p>
            </div>
            <Separator />
            <div>
              <p className="text-base">text-base (Inter)</p>
              <p className="text-muted-foreground text-xs font-mono">
                Only for the chat input.
              </p>
            </div>
            <Separator />
            <div>
              <p className="text-sm">text-sm (Inter)</p>
              <p className="text-muted-foreground text-xs font-mono">
                Chat messages, general text (Body).
              </p>
            </div>
            <Separator />
            <div>
              <p className="text-xs font-mono text-primary">
                text-xs font-mono
              </p>
              <p className="text-muted-foreground text-xs font-mono">
                Labels, plugin names, timestamps, commands.
              </p>
            </div>
          </div>
        </section>

        <Separator />

        {/* Componentes UI */}
        <section className="space-y-8">
          <h2 className="text-display text-lg">Shadcn Components</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Botones */}
            <div className="space-y-4">
              <h3 className="text-sm text-muted-foreground font-mono">
                Buttons
              </h3>
              <div className="flex flex-wrap gap-4">
                <Button>Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">Destructive</Button>
              </div>
            </div>

            {/* Badges & Avatar */}
            <div className="space-y-4">
              <h3 className="text-sm text-muted-foreground font-mono">
                Badges & Avatar
              </h3>
              <div className="flex items-center gap-4">
                <Badge>v0.1.0</Badge>
                <Badge variant="secondary">Local</Badge>
                <Badge variant="outline">CPU</Badge>
                <Badge variant="destructive">Error</Badge>
              </div>
              <div className="flex items-center gap-4 pt-2">
                <Avatar>
                  <AvatarFallback className="bg-primary/20 text-primary">
                    HQ
                  </AvatarFallback>
                </Avatar>
                <div className="space-y-1">
                  <p className="text-sm">HiveQueen</p>
                  <p className="text-xs font-mono text-muted-foreground">
                    Status: Active
                  </p>
                </div>
              </div>
            </div>

            {/* Textarea */}
            <div className="space-y-4 md:col-span-2">
              <h3 className="text-sm text-muted-foreground font-mono">
                Text input (Chat input)
              </h3>
              <Textarea
                placeholder="Type a message to the agent..."
                className="resize-none text-base"
                rows={3}
              />
            </div>

            {/* Skeleton */}
            <div className="space-y-4 md:col-span-2">
              <h3 className="text-sm text-muted-foreground font-mono">
                Loading state (Skeleton)
              </h3>
              <div className="flex items-center space-x-4">
                <Skeleton className="h-12 w-12 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-62.5" />
                  <Skeleton className="h-4 w-50" />
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function ColorSwatch({
  name,
  className,
  text,
}: {
  name: string;
  className: string;
  text: string;
}) {
  return (
    <div
      className={`p-4 rounded-md border flex flex-col justify-end h-24 shadow-sm ${className}`}
    >
      <span className={`text-xs font-mono font-medium ${text}`}>{name}</span>
    </div>
  );
}
