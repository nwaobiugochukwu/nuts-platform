import { adminApi } from "@/api/core/client";

export interface AdminStaffMember {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  firstName?: string | null;
  lastName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAdminStaffPayload {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

export interface PlatformConfig {
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  allowRegistrations: boolean;
  allowVendorRegistrations: boolean;
  updatedAt: string;
}

export interface SystemOverview {
  usersCount: number;
  vendorsCount: number;
  productsCount: number;
  ordersCount: number;
}

export interface GovernanceAuditLog {
  id: string;
  action: string;
  entity: string;
  entityId?: string | null;
  adminId?: string | null;
  payload?: Record<string, unknown> | null;
  ipAddress?: string | null;
  createdAt: string;
}

export interface StaffListResponse {
  items: AdminStaffMember[];
  total: number;
  page: number;
  limit: number;
}

export const adminGovernanceService = {
  getStaffList(params?: { page?: number; limit?: number; search?: string }) {
    return adminApi.get<StaffListResponse>("/admin/staff", { params }).then((res) => res.data);
  },

  createStaff(payload: CreateAdminStaffPayload) {
    return adminApi.post<AdminStaffMember>("/admin/staff", payload).then((res) => res.data);
  },

  updateStaffStatus(id: string, isActive: boolean) {
    return adminApi.patch<AdminStaffMember>(`/admin/staff/${id}/status`, { isActive }).then((res) => res.data);
  },

  getAuditLogs(limit = 50) {
    return adminApi.get<GovernanceAuditLog[]>("/admin/staff/audit-logs", { params: { limit } }).then((res) => res.data);
  },

  getPlatformConfig() {
    return adminApi.get<PlatformConfig>("/admin/platform/config").then((res) => res.data);
  },

  updatePlatformConfig(payload: Partial<PlatformConfig>) {
    return adminApi.patch<PlatformConfig>("/admin/platform/config", payload).then((res) => res.data);
  },

  getSystemOverview() {
    return adminApi.get<SystemOverview>("/admin/platform/overview").then((res) => res.data);
  },
};

