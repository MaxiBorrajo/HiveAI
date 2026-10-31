import { exportExecution } from "../api/exportExecution";
import { downloadFile, stringifyContent } from "@/lib/download";

/** Exports the saved version of an execution to a file the user picks. */
export async function exportAndDownload(id: string) {
  const { data } = await exportExecution(id);
  if (!data) return;
  if (
    data.secretWarnings.length > 0 &&
    !window.confirm(
      `${data.secretWarnings.length} field(s) look like they contain a secret (API key, token...). They would be exported as they are. Export anyway?`,
    )
  ) {
    return;
  }
  await downloadFile(data.filename, stringifyContent(data.file));
}
