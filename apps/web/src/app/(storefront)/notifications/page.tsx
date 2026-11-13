import { NotificationsManager } from "@/component/notification/NotificationsManager";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Notifications | NUTS Marketplace",
  description:
    "Stay updated on order status, deliveries, and account security.",
};

export default function NotificationsPage() {
  return (
    <NotificationsManager
      title="Notifications"
      subtitle="Stay updated on order status, deliveries, and security alerts."
      backHref="/"
      backLabel="Home"
    />
  );
}
