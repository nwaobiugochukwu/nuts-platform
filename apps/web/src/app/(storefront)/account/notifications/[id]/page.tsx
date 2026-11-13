import { redirect } from "next/navigation";

export default async function AccountNotificationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/notifications/${encodeURIComponent(id)}`);
}
