import { useEffect, useState } from "react";
import { getErrorMessage } from "@/lib/errors";
import { getAttachmentText, type AttachmentDto } from "../api/attachments";

export type LoadedText = { text: string } | { error: string } | undefined;

/** The file's text (documents give what was extracted from them); undefined while loading. */
export function useAttachmentText(attachment: AttachmentDto | null, enabled = true): LoadedText {
  const [loaded, setLoaded] = useState<{ id: number; value: LoadedText }>();
  const id = attachment?.id;

  useEffect(() => {
    if (!enabled || id === undefined) return;
    let cancelled = false;
    getAttachmentText(id)
      .then((response) => {
        if (cancelled) return;
        setLoaded({
          id,
          value: response.data
            ? { text: response.data.text }
            : { error: response.errors?.[0] ?? "Could not load the preview." },
        });
      })
      .catch((error) => {
        if (!cancelled) setLoaded({ id, value: { error: getErrorMessage(error, "Could not load the preview.") } });
      });
    return () => {
      cancelled = true;
    };
  }, [id, enabled]);

  return loaded && loaded.id === id ? loaded.value : undefined;
}
