import { API_URL } from "../config";
import type { ChatMode } from "@/types/chat";

export async function getModes(): Promise<ChatMode[]> {
  const response = await fetch(`${API_URL}/api/modes`);
  if (!response.ok) {
    throw new Error(`Failed to fetch modes: ${response.statusText}`);
  }
  return response.json();
}

