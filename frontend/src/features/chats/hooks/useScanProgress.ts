import { useEffect, useRef } from "react";
import { getAttachment, type AttachmentDto } from "../api/attachments.ts";

export const SCAN_POLL_MS = 2000;

/** Refreshes the attachments whose scanned pages are still being read. */
export function useScanProgress(
  attachments: AttachmentDto[],
  onChange?: (attachments: AttachmentDto[]) => void,
) {
  const latest = useRef({ attachments, onChange });
  useEffect(() => {
    latest.current = { attachments, onChange };
  });

  const pendingIds = attachments
    .filter((a) => a.scan?.status === "pending")
    .map((a) => a.id)
    .join(",");

  useEffect(() => {
    if (!pendingIds) return;
    const timer = setInterval(async () => {
      const fresh = await Promise.all(
        pendingIds.split(",").map((id) =>
          getAttachment(Number(id))
            .then((response) => response.data)
            .catch(() => undefined),
        ),
      );
      const byId = new Map(
        fresh.filter((a): a is AttachmentDto => !!a).map((a) => [a.id, a]),
      );
      const { attachments: current, onChange: notify } = latest.current;
      if (byId.size > 0 && notify) {
        notify(current.map((a) => byId.get(a.id) ?? a));
      }
    }, SCAN_POLL_MS);
    return () => clearInterval(timer);
  }, [pendingIds]);
}
