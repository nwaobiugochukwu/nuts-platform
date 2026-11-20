import { create } from "zustand";

const DEFAULT_MAINTENANCE_MESSAGE =
  "The platform is currently under maintenance. Please check back shortly.";

interface MaintenanceModeState {
  active: boolean;
  message: string;
}

export const useMaintenanceModeStore = create<MaintenanceModeState>(() => ({
  active: false,
  message: DEFAULT_MAINTENANCE_MESSAGE,
}));

export class MaintenanceModeError extends Error {
  readonly maintenanceMode = true;

  constructor(message: string) {
    super(message);
    this.name = "MaintenanceModeError";
  }
}

export function normalizeMaintenanceMessage(value: unknown): string {
  if (Array.isArray(value)) {
    const message = value.filter((part): part is string => typeof part === "string").join("\n").trim();
    return message || DEFAULT_MAINTENANCE_MESSAGE;
  }
  return typeof value === "string" && value.trim()
    ? value.trim()
    : DEFAULT_MAINTENANCE_MESSAGE;
}

export function activateMaintenanceMode(message: unknown): void {
  useMaintenanceModeStore.setState({
    active: true,
    message: normalizeMaintenanceMessage(message),
  });
}

export function clearMaintenanceMode(): void {
  useMaintenanceModeStore.setState({
    active: false,
    message: DEFAULT_MAINTENANCE_MESSAGE,
  });
}

export function isMaintenanceModeResponse(
  status: number | undefined,
  payload: unknown,
): boolean {
  if (status !== 503 || !payload || typeof payload !== "object") return false;
  return (payload as { maintenanceMode?: unknown }).maintenanceMode === true;
}

export function isMaintenanceModeError(error: unknown): boolean {
  if (error instanceof MaintenanceModeError) return true;
  if (!error || typeof error !== "object") return false;

  const candidate = error as {
    maintenanceMode?: unknown;
    response?: { status?: number; data?: unknown };
  };
  return (
    candidate.maintenanceMode === true ||
    isMaintenanceModeResponse(candidate.response?.status, candidate.response?.data)
  );
}
