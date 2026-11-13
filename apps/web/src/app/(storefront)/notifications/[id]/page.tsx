import { NotificationDetail } from "@/component/notification/NotificationDetail";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Notification Details | NUTS Marketplace",
};

export default async function NotificationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <NotificationDetail id={id} />;
}
