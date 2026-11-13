"use client";

import { NotificationsManager } from "@/component/notification/NotificationsManager";

export default function AdminNotificationsPage() {
  return (
    <NotificationsManager
      title="System Operations Notifications"
      subtitle="Real-time administrative feed for platform orders, payment alerts, and security events."
      backHref="/admin"
      backLabel="Admin Console"
    />
  );
}
