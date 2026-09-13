import { ResponseBuilder } from "./response.ts";

export async function parseJsonBody<T>(
  request: Request,
  headers: Record<string, string>,
): Promise<{ body: T } | { errorResponse: Response }> {
  try {
    const body = (await request.json()) as T;
    return { body };
  } catch {
    return {
      errorResponse: ResponseBuilder.error(["Invalid JSON body"], undefined, {
        headers,
        status: 400,
      }),
    };
  }
}
