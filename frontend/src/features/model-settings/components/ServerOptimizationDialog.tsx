import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useModels } from "@/features/models/ModelsContext";
import { getModelSettings } from "../api/getModelSettings";
import { setModelSettings } from "../api/setModelSettings";
import {
  dismissServerEnvPrompt,
  getServerEnvStatus,
} from "../api/serverEnv";

export function ServerOptimizationDialog() {
  const { current, runBusy } = useModels();
  const [isOpen, setIsOpen] = useState(false);
  const isLocal = current.provider === "ollama" && !!current.model;

  useEffect(() => {
    if (!isLocal) return;
    getServerEnvStatus()
      .then(({ data }) => setIsOpen(!!data?.pending))
      .catch(() => {});
  }, [isLocal]);

  const dismiss = async () => {
    setIsOpen(false);
    try {
      await dismissServerEnvPrompt();
    } catch {}
  };

  const apply = async () => {
    setIsOpen(false);
    await runBusy("Restarting Ollama with faster settings...", async () => {
      try {
        const { data } = await getModelSettings();
        const values = Object.fromEntries(
          (data ?? []).map((s) => [s.name, s.currentValue]),
        );
        await setModelSettings(values);
      } catch {}
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && dismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Make local models faster</DialogTitle>
          <DialogDescription>
            HiveAI recommends enabling flash attention and a full-precision
            (f16) KV cache on your Ollama server. In our tests this halved the
            time to the first token on CPU. Applying it restarts the Ollama
            service, affects every model, and may ask for your administrator
            password. You can change it later from Settings.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={dismiss}>
            Not now
          </Button>
          <Button onClick={apply}>Apply and restart</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
