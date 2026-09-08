import axios from "axios";
import { API_URL } from "../config";
import type { ChatMode } from "@/types/chat";

export async function getModes(): Promise<ChatMode[]> {
  const response = await axios.get(`${API_URL}/api/modes`);
  return response.data;
}
