import { isAxiosError } from "axios";
import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";

export interface Draft {
  name: string;
  dir: string;
  createdAt: string;
  updatedAt: string;
}

export interface DraftFile {
  name: string;
  content: string;
}

export interface DraftValidationResult {
  valid: boolean;
  issues: string[];
  counts?: Record<string, number>;
}

async function request<T>(
  method: "get" | "post" | "put" | "delete",
  path: string,
  body?: unknown,
): Promise<T> {
  try {
    const response = await apiClient.request<ResponseEntity<T>>({
      method,
      url: `/api/drafts${path}`,
      data: body,
      silenceErrorToast: true,
    });
    if (!response.data.success) {
      throw new Error(response.data.errors?.[0] || "Request failed");
    }
    return response.data.data as T;
  } catch (error) {
    if (isAxiosError(error)) {
      const body = error.response?.data as ResponseEntity | undefined;
      throw new Error(
        body?.errors?.[0] ||
          `Request failed with status ${error.response?.status ?? "unknown"}`,
      );
    }
    throw error;
  }
}

const draftPath = (name: string) => `/${encodeURIComponent(name)}`;

export async function listDrafts(): Promise<Draft[]> {
  return (await request<{ drafts: Draft[] }>("get", "")).drafts;
}

export function createDraft(name: string): Promise<Draft> {
  return request<Draft>("post", "", { name });
}

export async function getDraftFiles(name: string): Promise<DraftFile[]> {
  return (await request<{ files: DraftFile[] }>("get", `${draftPath(name)}/files`))
    .files;
}

export async function saveDraftFile(
  name: string,
  file: string,
  content: string,
): Promise<void> {
  await request("put", `${draftPath(name)}/files`, { file, content });
}

export function validateDraft(name: string): Promise<DraftValidationResult> {
  return request<DraftValidationResult>("post", `${draftPath(name)}/validate`);
}

export interface ImportDraftResult {
  name: string;
  description: string;
}

export function importDraft(name: string): Promise<ImportDraftResult> {
  return request<ImportDraftResult>("post", `${draftPath(name)}/import`);
}

export async function removeDraft(name: string): Promise<void> {
  await request("delete", draftPath(name));
}

export async function exportDraft(name: string): Promise<string> {
  return (await request<{ path: string }>("get", `${draftPath(name)}/export`)).path;
}
