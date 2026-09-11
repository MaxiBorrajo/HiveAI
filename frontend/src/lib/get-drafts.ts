import { API_URL } from "./config";

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

async function parseOrThrow<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }
  return data;
}

export async function listDrafts(): Promise<Draft[]> {
  const response = await fetch(`${API_URL}/api/drafts`);
  const data = await parseOrThrow<{ drafts: Draft[] }>(response);
  return data.drafts;
}

export async function createDraft(name: string): Promise<Draft> {
  const response = await fetch(`${API_URL}/api/drafts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return parseOrThrow<Draft>(response);
}

export async function getDraftFiles(name: string): Promise<DraftFile[]> {
  const response = await fetch(`${API_URL}/api/drafts/${encodeURIComponent(name)}/files`);
  const data = await parseOrThrow<{ files: DraftFile[] }>(response);
  return data.files;
}

export async function saveDraftFile(name: string, file: string, content: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/drafts/${encodeURIComponent(name)}/files`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file, content }),
  });
  await parseOrThrow(response);
}

export async function validateDraft(name: string): Promise<DraftValidationResult> {
  const response = await fetch(`${API_URL}/api/drafts/${encodeURIComponent(name)}/validate`, {
    method: "POST",
  });
  return parseOrThrow<DraftValidationResult>(response);
}

export interface ImportDraftResult {
  name: string;
  description: string;
}

export async function importDraft(name: string): Promise<ImportDraftResult> {
  const response = await fetch(`${API_URL}/api/drafts/${encodeURIComponent(name)}/import`, {
    method: "POST",
  });
  return parseOrThrow<ImportDraftResult>(response);
}

export async function removeDraft(name: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/drafts/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  await parseOrThrow(response);
}

// Downloads a .zip of the draft (with the plugin's own name as the
// top-level folder inside) so it can be shared and imported on another
// machine through the ordinary "Import Plugin" folder-upload flow.
export async function exportDraft(name: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/drafts/${encodeURIComponent(name)}/export`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Export failed with status ${response.status}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.zip`;
  link.click();
  URL.revokeObjectURL(url);
}
