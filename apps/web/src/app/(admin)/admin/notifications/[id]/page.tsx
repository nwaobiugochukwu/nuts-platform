import { NotificationDetail } from "@/component/notification/NotificationDetail";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Notification | NUTS-P Admin",
};

export default async function AdminNotificationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <NotificationDetail id={id} />;
}
