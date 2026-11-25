import { request, type APIRequestContext } from "@playwright/test";

export function createRequestContext(options: {
  baseURL: string;
  timeout: number;
  extraHTTPHeaders?: Record<string, string>;
}): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: options.baseURL,
    timeout: options.timeout,
    extraHTTPHeaders: options.extraHTTPHeaders,
  });
}
