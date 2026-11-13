import { adminApi } from "@/api/core/client";

export type AnnouncementAudience = "CUSTOMERS" | "VENDORS" | "ADMINISTRATORS";
export type CampaignAudience = Exclude<AnnouncementAudience, "ADMINISTRATORS">;
export type AnnouncementStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "FAILED"
  | "ARCHIVED";
export type AnnouncementPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface AdminAnnouncement {
  id: string;
  title: string;
  message: string;
  audience: AnnouncementAudience;
  priority: AnnouncementPriority;
  link: string | null;
  status: AnnouncementStatus;
  scheduledAt: string | null;
  processingAt: string | null;
  publishedAt: string | null;
  recipientCount: number;
  lastError: string | null;
  createdByAdminId: string | null;
  createdByAdmin?: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnnouncementAudienceCounts {
  users: number;
  vendors: number;
}

export interface AnnouncementOverview extends AnnouncementAudienceCounts {
  activeCampaigns: number;
  recipientsReached: number;
}

export interface AnnouncementListResponse {
  items: AdminAnnouncement[];
  total: number;
  page: number;
  limit: number;
}

export interface AnnouncementPayload {
  title: string;
  message: string;
  audience: CampaignAudience;
  priority: AnnouncementPriority;
  link?: string | null;
}

export const adminAnnouncementsService = {
  list(params?: {
    audience?: AnnouncementAudience;
    status?: AnnouncementStatus;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    return adminApi
      .get<AnnouncementListResponse>("/admin/announcements", { params })
      .then((response) => response.data);
  },

  getAudienceCounts() {
    return adminApi
      .get<AnnouncementAudienceCounts>("/admin/announcements/audience-counts")
      .then((response) => response.data);
  },

  getOverview() {
    return adminApi
      .get<AnnouncementOverview>("/admin/announcements/overview")
      .then((response) => response.data);
  },

  create(payload: AnnouncementPayload) {
    return adminApi
      .post<AdminAnnouncement>("/admin/announcements", payload)
      .then((response) => response.data);
  },

  update(id: string, payload: AnnouncementPayload) {
    return adminApi
      .patch<AdminAnnouncement>(`/admin/announcements/${id}`, payload)
      .then((response) => response.data);
  },

  publish(id: string) {
    return adminApi
      .post<AdminAnnouncement>(`/admin/announcements/${id}/publish`)
      .then((response) => response.data);
  },

  schedule(id: string, scheduledAt: string) {
    return adminApi
      .post<AdminAnnouncement>(`/admin/announcements/${id}/schedule`, {
        scheduledAt,
      })
      .then((response) => response.data);
  },

  archive(id: string) {
    return adminApi
      .post<AdminAnnouncement>(`/admin/announcements/${id}/archive`)
      .then((response) => response.data);
  },
};
