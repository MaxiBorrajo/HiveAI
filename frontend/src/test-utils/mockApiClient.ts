import { vi } from "vitest";

export type MockMethod = "get" | "post" | "put" | "patch" | "delete";

export interface MockRoute {
  method: MockMethod;
  /** Exact path or a RegExp tested against the request path. */
  match: string | RegExp;
  handler: (...args: unknown[]) => unknown;
}

function matches(route: MockRoute, method: MockMethod, path: string): boolean {
  if (route.method !== method) return false;
  return typeof route.match === "string"
    ? route.match === path
    : route.match.test(path);
}

/**
 * A minimal stand-in for the app's axios instance (`apiClient`), routed by
 * HTTP method + path instead of mocking axios directly — this app always
 * calls `apiClient.get/post/.../request`, never the bare `axios` export, so
 * mocking at that level keeps every feature's API client working unchanged
 * against a fake backend.
 */
export function createMockApiClient(routes: MockRoute[]) {
  async function dispatch(method: MockMethod, path: string, ...rest: unknown[]) {
    const route = routes.find((r) => matches(r, method, path));
    if (!route) {
      throw new Error(`No mock route for ${method.toUpperCase()} ${path}`);
    }
    const data = await route.handler(...rest);
    return { data };
  }

  return {
    get: vi.fn((path: string, ...rest: unknown[]) => dispatch("get", path, ...rest)),
    post: vi.fn((path: string, ...rest: unknown[]) => dispatch("post", path, ...rest)),
    put: vi.fn((path: string, ...rest: unknown[]) => dispatch("put", path, ...rest)),
    patch: vi.fn((path: string, ...rest: unknown[]) => dispatch("patch", path, ...rest)),
    delete: vi.fn((path: string, ...rest: unknown[]) => dispatch("delete", path, ...rest)),
    request: vi.fn(
      ({ method, url, data: body }: { method: MockMethod; url: string; data?: unknown }) =>
        dispatch(method, url, body),
    ),
  };
}

export function ok<T>(data: T) {
  return { success: true, data };
}

export function fail<T>(errors: string[], data?: T) {
  return { success: false, errors, data };
}
