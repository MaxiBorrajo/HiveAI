import { Toast } from "@base-ui/react/toast";

export const toastManager = Toast.createToastManager();

export function reportError(errors: string[]) {
  const description =
    errors.filter(Boolean).join("; ") || "Something went wrong";
  toastManager.add({
    type: "error",
    title: "Something went wrong",
    description,
  });
}

export function reportSuccess(title: string, description?: string) {
  toastManager.add({
    type: "success",
    title,
    description,
  });
}
