import { exportExecution } from "../api/exportExecution";
import { reportSuccess } from "@/lib/toastManager";

/** Exports the saved version of an execution as a .hiveai-flow.zip in Downloads. */
export async function exportAndDownload(id: string) {
  let { data } = await exportExecution(id);
  if (!data) return;
  if (!data.saved) {
    if (
      !window.confirm(
        `${data.secretWarnings.length} field(s) look like they contain a secret (API key, token...). They would be exported as they are. Export anyway?`,
      )
    ) {
      return;
    }
    ({ data } = await exportExecution(id, { confirmSecrets: true }));
  }
  if (data?.path) reportSuccess("Flow exported", data.path);
}
