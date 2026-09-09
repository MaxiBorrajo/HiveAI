import { API_URL } from "./config";
import type {
  Plugin,
  SelectionTestCase,
  ExecutionTestCase,
} from "@/types/plugin";

interface BackendPlugin {
  name: string;
  description: string;
  active: boolean;
  selectionTests?: SelectionTestCase[];
  executionTests?: ExecutionTestCase[];
  isExternal?: boolean;
}

export async function getPlugins(): Promise<Plugin[]> {
  const response = await fetch(`${API_URL}/api/plugins`);
  const plugins: BackendPlugin[] = await response.json();

  return plugins.map((plugin) => ({
    id: plugin.name,
    name: plugin.name,
    description: plugin.description,
    active: plugin.active,
    selectionTests: plugin.selectionTests || [],
    executionTests: plugin.executionTests || [],
    isExternal: plugin.isExternal ?? false,
  }));
}

export async function setPluginActive(
  name: string,
  active: boolean,
): Promise<void> {
  await fetch(
    `${API_URL}/api/plugins/${encodeURIComponent(name)}/${active ? "activate" : "deactivate"}`,
    { method: "POST" },
  );
}

export interface ImportPluginResult {
  name: string;
  description: string;
}

// `files` comes straight from an <input webkitdirectory> change event — each
// File carries its `webkitRelativePath` (e.g. "my-plugin/index.ts"), which
// is what lets the backend reconstruct the folder structure server-side.
// Browsers never expose the real absolute path of a user-picked folder, so
// this is the only way to hand the plugin's contents to the backend.
export async function importPlugin(files: FileList): Promise<ImportPluginResult> {
  const form = new FormData();
  for (const file of Array.from(files)) {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    form.append(relativePath, file, relativePath);
  }

  const response = await fetch(`${API_URL}/api/plugins/import`, {
    method: "POST",
    body: form,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Import failed with status ${response.status}`);
  }
  return data;
}

export async function removePlugin(name: string): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/plugins/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Remove failed with status ${response.status}`);
  }
}

// Downloads a .zip of an already-imported external plugin (with its own
// name as the top-level folder inside), so it can be shared and re-imported
// on another machine through the same "Import Plugin" folder-upload flow.
export async function exportPlugin(name: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/plugins/${encodeURIComponent(name)}/export`);
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

export interface EditPluginResult {
  name: string;
  dir: string;
}

// Turns an already-imported external plugin back into an editable draft
// (deactivating it and removing it from the plugin list in the process) —
// the caller is expected to open the draft editor for `name` right after.
export async function editPlugin(name: string): Promise<EditPluginResult> {
  const response = await fetch(`${API_URL}/api/plugins/${encodeURIComponent(name)}/edit`, {
    method: "POST",
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Edit failed with status ${response.status}`);
  }
  return data;
}

export async function runPluginTest(
  name: string,
  type: "selection" | "execution",
  index: number,
  signal: AbortSignal,
) {
  const response = await fetch(
    `${API_URL}/api/plugins/${encodeURIComponent(name)}/test/${type}/${index}`,
    {
      method: "POST",
      signal,
    },
  );
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}
