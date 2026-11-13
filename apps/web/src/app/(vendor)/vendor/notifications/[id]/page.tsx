import { NotificationDetail } from "@/component/notification/NotificationDetail";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Notification | NUTS-P Vendor",
};

export default async function VendorNotificationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <NotificationDetail id={id} />;
}
