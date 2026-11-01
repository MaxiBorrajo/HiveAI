import { Toast } from "@base-ui/react/toast";

export const toastManager = Toast.createToastManager();

/** Longer than this (or multi-line), an error moves to the details dialog. */
const MAX_INLINE_LENGTH = 160;
const DETAILS_TOAST_TIMEOUT_MS = 15000;

export interface ToastDetails {
  details: string;
}

export function reportError(errors: string[]) {
  const messages = errors.filter(Boolean);
  const full = messages.join("\n");
  const isLong =
    full.length > MAX_INLINE_LENGTH || messages.some((m) => m.includes("\n"));

  if (!isLong) {
    toastManager.add({
      type: "error",
      title: "Something went wrong",
      description: messages.join("; ") || "Something went wrong",
    });
    return;
  }

  const firstLine = full.split("\n")[0].trim();
  const summary =
    firstLine.length > MAX_INLINE_LENGTH
      ? `${firstLine.slice(0, MAX_INLINE_LENGTH)}…`
      : firstLine;
  toastManager.add({
    type: "error",
    title: "Something went wrong",
    description: summary,
    timeout: DETAILS_TOAST_TIMEOUT_MS,
    data: { details: full } satisfies ToastDetails,
  });
}

export function reportWarning(title: string, description?: string) {
  toastManager.add({ type: "warning", title, description });
}

export function reportSuccess(title: string, description?: string) {
  toastManager.add({
    type: "success",
    title,
    description,
  });
}
