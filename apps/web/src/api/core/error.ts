import type { AxiosError } from "axios";
import type { ApiErrorEnvelope } from "./types";

export interface ApiClientErrorPayload {
  message: string;
  code?: string;
  details?: unknown;
  status?: number;
}

export function isApiErrorBody(
  value: unknown
): value is ApiErrorEnvelope {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.success === false && typeof record.message === "string";
}

export function isApiErrorEnvelope(
  error: unknown
): error is AxiosError<ApiErrorEnvelope> {
  if (!isApiClientError(error)) return false;
  return isApiErrorBody(error.response?.data);
}

function isAxiosError(error: unknown): error is AxiosError {
  return (
    !!error &&
    typeof error === "object" &&
    "isAxiosError" in error &&
    (error as AxiosError).isAxiosError === true
  );
}

export function isApiClientError(
  error: unknown
): error is AxiosError {
  return isAxiosError(error);
}

export function toApiErrorPayload(error: unknown): ApiClientErrorPayload {
  if (isApiClientError(error) && error.response) {
    if (isApiErrorBody(error.response.data)) {
      const body = error.response.data;
      return {
        message: body.message,
        code: body.error?.code,
        details: body.error?.details,
        status: error.response.status,
      };
    }

    const data = error.response.data;
    const message =
      typeof data === "string"
        ? data
        : (data as { message?: unknown } | null)?.message;
    return {
      message: typeof message === "string" ? message : error.message,
      status: error.response.status,
    };
  }

  if (error instanceof Error) {
    return { message: error.message };
  }

  return { message: "Something went wrong. Please try again." };
}

export function getApiErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again."
): string {
  return toApiErrorPayload(error).message || fallback;
}