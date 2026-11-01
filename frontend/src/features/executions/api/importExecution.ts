import { isAxiosError } from "axios";
import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { SecretWarning } from "./exportExecution";

export interface ImportPreview {
  name: string;
  nameConflict: number | null;
  missingPlugins: string[];
  unbundledMissingPlugins: string[];
  inactivePlugins: string[];
  bundledPlugins: {
    name: string;
    status: "missing" | "alreadyInstalled";
    /** File name -> source code, so the user can review it before installing. */
    files: Record<string, string>;
    /** Why the plugin does not match this version's BeePlugin interface. */
    conformanceIssues: string[];
  }[];
  violations: { nodeName: string; reason: string }[];
  secretWarnings: SecretWarning[];
}

export interface ImportResult {
  executionId: number;
  name: string;
  isDraft: boolean;
  missingPlugins: string[];
  inactivePlugins: string[];
  plugins: { name: string; installed: boolean; error?: string }[];
}

export type ImportOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; errors: string[]; violations?: ImportPreview["violations"] };

async function post<T>(
  url: string,
  body: FormData,
): Promise<ImportOutcome<T>> {
  try {
    const { data } = await apiClient.post<
      ResponseEntity<T & { violations?: ImportPreview["violations"] }>
    >(url, body, { silenceErrorToast: true });
    if (data.success && data.data) return { ok: true, data: data.data };
    return { ok: false, errors: data.errors ?? ["Request failed"] };
  } catch (error) {
    if (isAxiosError(error) && error.response?.data) {
      const body = error.response.data as ResponseEntity<{
        violations?: ImportPreview["violations"];
      }>;
      return {
        ok: false,
        errors: body.errors?.length ? body.errors : [error.message],
        violations: body.data?.violations,
      };
    }
    return { ok: false, errors: ["Could not reach the server."] };
  }
}

export function previewImport(file: File) {
  const form = new FormData();
  form.append("file", file, file.name);
  return post<ImportPreview>("/api/executions/import/preview", form);
}

export function importExecution(
  file: File,
  options: {
    conflict?: "new" | "overwrite";
    installBundledPlugins: string[];
  },
) {
  const form = new FormData();
  form.append("file", file, file.name);
  if (options.conflict) form.append("conflict", options.conflict);
  form.append(
    "installBundledPlugins",
    JSON.stringify(options.installBundledPlugins),
  );
  return post<ImportResult>("/api/executions/import", form);
}
