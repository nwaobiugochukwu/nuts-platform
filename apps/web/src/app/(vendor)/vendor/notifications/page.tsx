"use client";

import { NotificationsManager } from "@/component/notification/NotificationsManager";

export default function VendorDashboardNotificationsPage() {
  return (
    <NotificationsManager
      title="Vendor Notifications"
      subtitle="Real-time alerts for customer purchases, wallet payouts, low inventory, and customer reviews."
      backHref="/vendor/analytic"
      backLabel="Dashboard"
    />
  );
}
