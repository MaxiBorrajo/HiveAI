import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  closeErrorDetails,
  copyToClipboard,
  useErrorDetails,
} from "@/lib/errorDetails";
import { reportSuccess } from "@/lib/toastManager";

/** Shows the full text of an error whose toast only had room for a summary. */
export function ErrorDetailsDialog() {
  const details = useErrorDetails();

  async function handleCopy() {
    if (details && (await copyToClipboard(details.text))) {
      reportSuccess("Error copied to the clipboard");
    }
  }

  return (
    <Dialog
      open={details !== null}
      onOpenChange={(open) => !open && closeErrorDetails()}
    >
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{details?.title}</DialogTitle>
        </DialogHeader>
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded border p-3 font-mono text-xs select-text">
          {details?.text}
        </pre>
        <DialogFooter>
          <Button variant="secondary" onClick={handleCopy}>
            Copy
          </Button>
          <Button onClick={closeErrorDetails}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
