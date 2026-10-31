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
  bundledPlugins: { name: string; status: "missing" | "alreadyInstalled" }[];
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
  body: unknown,
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

export function previewImport(file: unknown) {
  return post<ImportPreview>("/api/executions/import/preview", { file });
}

export function importExecution(
  file: unknown,
  options: {
    conflict?: "new" | "overwrite";
    installBundledPlugins: string[];
  },
) {
  return post<ImportResult>("/api/executions/import", { file, ...options });
}
