import axios, { isAxiosError, isCancel } from "axios";
import { API_URL, type ResponseEntity } from "./config";
import { reportError } from "./toastManager";

export const apiClient = axios.create({ baseURL: API_URL });

declare module "axios" {
  export interface AxiosRequestConfig {
    silenceErrorToast?: boolean;
  }
}

function extractErrors(error: unknown): string[] {
  if (isAxiosError(error)) {
    const data = error.response?.data as ResponseEntity | undefined;
    if (data?.errors?.length) return data.errors;
    if (error.message) return [error.message];
  }
  if (error instanceof Error) return [error.message];
  return ["Something went wrong"];
}

apiClient.interceptors.response.use(
  (response) => {
    const body = response.data as ResponseEntity | undefined;
    if (body && body.success === false && !response.config.silenceErrorToast) {
      reportError(body.errors?.length ? body.errors : ["Request failed"]);
    }
    return response;
  },
  (error) => {
    if (!isCancel(error) && !error.config?.silenceErrorToast) {
      reportError(extractErrors(error));
    }
    return Promise.reject(error);
  },
);
