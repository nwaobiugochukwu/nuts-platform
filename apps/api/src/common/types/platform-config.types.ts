/** The platform-wide switches an admin can change. Read by guards and middleware; written by the platform module. */
export interface PlatformConfig {
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  /** Older name for the maintenance message, kept for clients that still read it. */
  announcement?: string | null;
  allowRegistrations: boolean;
  allowVendorRegistrations: boolean;
  updatedAt: Date;
}
