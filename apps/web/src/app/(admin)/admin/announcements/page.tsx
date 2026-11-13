"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  adminAnnouncementsService,
  type AdminAnnouncement,
  type AnnouncementAudience,
  type CampaignAudience,
  type AnnouncementPayload,
  type AnnouncementStatus,
} from "@/api";
import { PageHeader } from "@/component/common/PageHeader";
import { Button } from "@/component/ui/button";
import { Card } from "@/component/ui/card";
import { Badge } from "@/component/ui/badge";
import { Input } from "@/component/ui/input";
import { Label } from "@/component/ui/label";
import { queryKey } from "@/lib/query-key";
import { getApiErrorMessage } from "@/api/core/error";
import { ConfirmDialog } from "@/component/modal/ConfirmDialog";

type AudienceFilter = AnnouncementAudience | "ALL";
type StatusFilter = AnnouncementStatus | "ALL";
type SaveAction = "draft" | "publish" | "schedule";
type AnnouncementFormState = Omit<AnnouncementPayload, "audience"> & {
  audience: AnnouncementAudience;
};
type PendingConfirmation =
  | { kind: "publish-composer" }
  | { kind: "publish-campaign"; announcement: AdminAnnouncement }
  | { kind: "archive"; announcement: AdminAnnouncement };

const EMPTY_FORM: AnnouncementPayload = {
  title: "",
  message: "",
  audience: "CUSTOMERS",
  priority: "MEDIUM",
  link: "",
};

const ANNOUNCEMENT_DESTINATIONS: Record<CampaignAudience, { value: string; label: string }[]> = {
  CUSTOMERS: [
    { value: "/", label: "Marketplace home" },
    { value: "/product", label: "Browse products" },
    { value: "/search", label: "Search products" },
    { value: "/cart", label: "Shopping cart" },
    { value: "/order", label: "My orders" },
    { value: "/account/following", label: "Followed stores" },
  ],
  VENDORS: [
    { value: "/vendor/product", label: "Products" },
    { value: "/vendor/order", label: "Orders" },
    { value: "/vendor/analytic", label: "Analytics" },
    { value: "/vendor/discount", label: "Promotions" },
    { value: "/vendor/setting", label: "Store settings" },
    { value: "/vendor/notifications", label: "Notifications" },
    { value: "/vendor/wallet", label: "Wallet" },
  ],
};

function localDateTimeValue(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function audienceLabel(audience: AnnouncementAudience): string {
  if (audience === "CUSTOMERS") return "Users";
  if (audience === "VENDORS") return "Vendors";
  return "Legacy admin audience";
}

function destinationLabel(announcement: AdminAnnouncement): string | null {
  if (!announcement.link) return null;
  if (announcement.audience === "ADMINISTRATORS") return "Legacy internal destination";
  return ANNOUNCEMENT_DESTINATIONS[announcement.audience].find(
    (destination) => destination.value === announcement.link,
  )?.label ?? "Legacy internal destination";
}

function statusClasses(status: AnnouncementStatus): string {
  switch (status) {
    case "PUBLISHED":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "SCHEDULED":
      return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300";
    case "PUBLISHING":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "FAILED":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "ARCHIVED":
      return "border-border bg-muted text-muted-foreground";
    default:
      return "border-border bg-background text-muted-foreground";
  }
}

function displayDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export default function AdminAnnouncementsPage() {
  const queryClient = useQueryClient();
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<AnnouncementFormState>(EMPTY_FORM);
  const [scheduledAt, setScheduledAt] = useState("");
  const [minimumScheduledAt, setMinimumScheduledAt] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    const updateMinimum = () => {
      if (!cancelled) {
        setMinimumScheduledAt(
          localDateTimeValue(new Date(Date.now() + 60_000).toISOString()),
        );
      }
    };
    queueMicrotask(updateMinimum);
    const interval = window.setInterval(updateMinimum, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const listKey = useMemo(
    () => [...queryKey.admin.announcements, audienceFilter, statusFilter, search, page],
    [audienceFilter, statusFilter, search, page],
  );
  const announcementsQuery = useQuery({
    queryKey: listKey,
    queryFn: () =>
      adminAnnouncementsService.list({
        audience: audienceFilter === "ALL" ? undefined : audienceFilter,
        status: statusFilter === "ALL" ? undefined : statusFilter,
        search: search || undefined,
        page,
        limit: 20,
      }),
    refetchInterval: (query) =>
      query.state.data?.items.some((item) => item.status === "PUBLISHING")
        ? 8_000
        : false,
  });
  const audienceCountsQuery = useQuery({
    queryKey: [...queryKey.admin.announcements, "audience-counts"],
    queryFn: () => adminAnnouncementsService.getAudienceCounts(),
    staleTime: 60_000,
  });
  const overviewQuery = useQuery({
    queryKey: [...queryKey.admin.announcements, "overview"],
    queryFn: () => adminAnnouncementsService.getOverview(),
    staleTime: 30_000,
  });

  async function refreshAnnouncements() {
    await queryClient.invalidateQueries({ queryKey: queryKey.admin.announcements });
  }

  const publishMutation = useMutation({
    mutationFn: (id: string) => adminAnnouncementsService.publish(id),
    onSuccess: () => {
      toast.success("Announcement delivery started");
      void refreshAnnouncements();
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Could not publish announcement"));
    },
  });
  const archiveMutation = useMutation({
    mutationFn: (id: string) => adminAnnouncementsService.archive(id),
    onSuccess: () => {
      toast.success("Announcement archived");
      void refreshAnnouncements();
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Could not archive announcement"));
    },
  });

  function resetComposer() {
    const audience: CampaignAudience = audienceFilter === "VENDORS" ? "VENDORS" : "CUSTOMERS";
    setForm({ ...EMPTY_FORM, audience });
    setScheduledAt("");
    setEditingId(null);
  }

  function editAnnouncement(announcement: AdminAnnouncement) {
    setEditingId(announcement.id);
    setForm({
      title: announcement.title,
      message: announcement.message,
      audience: announcement.audience,
      priority: announcement.priority,
      link: announcement.link ?? "",
    });
    setScheduledAt(localDateTimeValue(announcement.scheduledAt));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveAnnouncement(action: SaveAction) {
    if (form.audience === "ADMINISTRATORS") {
      toast.error("Choose customers or vendors to retarget this legacy campaign");
      return;
    }
    const payload: AnnouncementPayload = {
      title: form.title.trim(),
      message: form.message.trim(),
      audience: form.audience,
      priority: form.priority,
      link: form.link?.trim() || null,
    };
    if (!payload.title || !payload.message) {
      toast.error("Add a title and message before saving");
      return;
    }
    if (action === "schedule" && !scheduledAt) {
      toast.error("Choose a delivery date and time");
      return;
    }
    if (action === "schedule" && new Date(scheduledAt) <= new Date()) {
      toast.error("Choose a future delivery time");
      return;
    }

    setIsSaving(true);
    let newlyCreatedAnnouncementId: string | null = null;
    try {
      const saved = editingId
        ? await adminAnnouncementsService.update(editingId, payload)
        : await adminAnnouncementsService.create(payload);
      if (!editingId) newlyCreatedAnnouncementId = saved.id;

      if (action === "publish") {
        await adminAnnouncementsService.publish(saved.id);
        toast.success("Announcement delivery started");
      } else if (action === "schedule") {
        const deliveryDate = new Date(scheduledAt);
        await adminAnnouncementsService.schedule(saved.id, deliveryDate.toISOString());
        toast.success("Announcement scheduled");
      } else {
        toast.success(editingId ? "Draft updated" : "Draft saved");
      }

      resetComposer();
      setPendingConfirmation(null);
      await refreshAnnouncements();
    } catch (error) {
      if (newlyCreatedAnnouncementId) {
        resetComposer();
        setPendingConfirmation(null);
        await refreshAnnouncements();
        toast.error("The draft was saved, but the requested action could not be confirmed. Check its campaign status before retrying.");
      } else {
        toast.error(getApiErrorMessage(error, "Could not save announcement"));
      }
    } finally {
      setIsSaving(false);
    }
  }

  const items = announcementsQuery.data?.items ?? [];
  const counts = audienceCountsQuery.data;
  const overview = overviewQuery.data;
  const totalItems = announcementsQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalItems / 20));
  const pendingAnnouncement = pendingConfirmation?.kind === "publish-campaign" || pendingConfirmation?.kind === "archive"
    ? pendingConfirmation.announcement
    : null;
  const confirmationIsPublish = pendingConfirmation?.kind === "publish-composer" || pendingConfirmation?.kind === "publish-campaign";
  const confirmationAudience = pendingConfirmation?.kind === "publish-composer"
    ? form.audience
    : pendingAnnouncement?.audience;
  const confirmationAudienceSize = confirmationAudience === "CUSTOMERS"
    ? counts?.users
    : confirmationAudience === "VENDORS"
      ? counts?.vendors
      : undefined;
  const anyActionPending = publishMutation.isPending || archiveMutation.isPending || isSaving;
  const selectedDestinationIsLegacy = form.audience !== "ADMINISTRATORS" && Boolean(form.link) &&
    !ANNOUNCEMENT_DESTINATIONS[form.audience].some((destination) => destination.value === form.link);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 sm:space-y-8">
      <PageHeader
        title="Global Announcements"
        description="Create, schedule, and track in-app campaigns for users or vendors."
      />

      <section aria-label="Announcement overview" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 sm:gap-4">
        {[
          { label: "Active users", value: counts?.users },
          { label: "Active vendors", value: counts?.vendors },
          { label: "Active campaigns", value: overview?.activeCampaigns },
          { label: "Recipients reached", value: overview?.recipientsReached },
        ].map((stat) => (
          <Card key={stat.label} className="min-w-0 p-4 sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {stat.label}
            </p>
            <p className="mt-2 break-words text-2xl font-bold tracking-tight sm:text-3xl">
              {stat.value?.toLocaleString() ?? "—"}
            </p>
          </Card>
        ))}
      </section>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] xl:gap-8">
        <Card className="min-w-0 p-4 shadow-xs sm:p-6">
          <div className="flex flex-col gap-1 border-b border-border pb-4">
            <h2 className="text-lg font-semibold">{editingId ? "Edit announcement" : "Compose announcement"}</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Recipients get an in-app notification and live update. Drafts are private until published or scheduled.
            </p>
          </div>

          <form
            className="space-y-5 pt-5"
            onSubmit={(event) => {
              event.preventDefault();
              void saveAnnouncement("draft");
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="announcement-audience">Audience</Label>
              <select
                id="announcement-audience"
                value={form.audience}
                onChange={(event) => {
                  const audience = event.target.value as CampaignAudience;
                  setForm((current) => ({
                    ...current,
                    audience,
                    link: ANNOUNCEMENT_DESTINATIONS[audience].some((item) => item.value === current.link)
                      ? current.link
                      : "",
                  }));
                }}
                className="flex h-11 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="CUSTOMERS">Users · {counts?.users.toLocaleString() ?? "…"} active</option>
                <option value="VENDORS">Vendors · {counts?.vendors.toLocaleString() ?? "…"} active</option>
                {form.audience === "ADMINISTRATORS" && (
                  <option value="ADMINISTRATORS" disabled>Legacy administrators · choose a new audience</option>
                )}
              </select>
              {form.audience === "ADMINISTRATORS" ? (
                <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">This historical campaign can’t be delivered to administrators. Choose customers or vendors before saving or publishing.</p>
              ) : (
                <p className="text-xs leading-5 text-muted-foreground">Each campaign targets one audience. Create a separate campaign for the other audience.</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="announcement-title">Title</Label>
              <Input
                id="announcement-title"
                value={form.title}
                maxLength={120}
                required
                placeholder="A clear, concise subject"
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              />
              <p className="text-right text-xs text-muted-foreground">{form.title.length}/120</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="announcement-message">Message</Label>
              <textarea
                id="announcement-message"
                value={form.message}
                maxLength={2000}
                required
                rows={5}
                placeholder="Share the details recipients need to know."
                onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))}
                className="flex min-h-32 w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm leading-6 shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="text-right text-xs text-muted-foreground">{form.message.length}/2000</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0 space-y-2">
                <Label htmlFor="announcement-priority">Priority</Label>
                <select
                  id="announcement-priority"
                  value={form.priority}
                  onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as AnnouncementPayload["priority"] }))}
                  className="flex h-11 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Normal</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </div>
              <div className="min-w-0 space-y-2">
                <Label htmlFor="announcement-link">In-app destination</Label>
                <select
                  id="announcement-link"
                  value={form.link ?? ""}
                  onChange={(event) => setForm((current) => ({ ...current, link: event.target.value }))}
                  disabled={form.audience === "ADMINISTRATORS"}
                  className="flex h-11 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">No destination</option>
                  {form.audience !== "ADMINISTRATORS" && ANNOUNCEMENT_DESTINATIONS[form.audience].map((destination) => (
                    <option key={destination.value} value={destination.value}>{destination.label}</option>
                  ))}
                  {selectedDestinationIsLegacy && form.link && (
                    <option value={form.link} disabled>Legacy destination · choose a supported destination</option>
                  )}
                  {form.audience === "ADMINISTRATORS" && form.link && (
                    <option value={form.link} disabled>Legacy destination · choose a new audience</option>
                  )}
                </select>
                <p className="text-xs leading-5 text-muted-foreground">Choose where this in-app message opens; destinations stay inside the platform.</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="announcement-schedule">Schedule delivery (optional)</Label>
              <Input
                id="announcement-schedule"
                type="datetime-local"
                value={scheduledAt}
                min={minimumScheduledAt || undefined}
                onChange={(event) => setScheduledAt(event.target.value)}
              />
              <p className="text-xs leading-5 text-muted-foreground">Scheduled announcements are checked every minute and delivered in resumable batches.</p>
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recipient preview</p>
              <p className="mt-2 text-sm font-semibold">{form.title.trim() || "Announcement title"}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{form.message.trim() || "Your message preview will appear here."}</p>
              <p className="mt-3 text-xs text-muted-foreground">{audienceLabel(form.audience)} · In-app notification · {form.priority.toLowerCase()} priority</p>
            </div>

            <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:flex-wrap sm:justify-end">
              {editingId && (
                <Button type="button" variant="ghost" onClick={resetComposer} disabled={isSaving} className="w-full sm:w-auto">
                  Cancel editing
                </Button>
              )}
              <Button type="submit" variant="outline" disabled={isSaving} className="w-full sm:w-auto">
                {isSaving ? "Saving…" : "Save draft"}
              </Button>
              <Button type="button" variant="outline" disabled={isSaving} onClick={() => void saveAnnouncement("schedule")} className="w-full sm:w-auto">
                Schedule
              </Button>
              <Button
                type="button"
                disabled={isSaving}
                onClick={() => {
                  if (!form.title.trim() || !form.message.trim()) {
                    toast.error("Add a title and message before publishing");
                    return;
                  }
                  setPendingConfirmation({ kind: "publish-composer" });
                }}
                className="w-full sm:w-auto"
              >
                {isSaving ? "Working…" : "Publish now"}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="min-w-0 overflow-hidden p-0 shadow-xs">
          <div className="flex flex-col gap-4 border-b border-border p-4 sm:p-6">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Campaigns</h2>
                <p className="text-sm text-muted-foreground">Delivery state and recipient totals</p>
              </div>
              <span className="text-xs text-muted-foreground">
                {announcementsQuery.data?.total ?? 0} total
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Filter announcement campaigns by audience">
              {([
                ["ALL", "All audiences"],
                ["CUSTOMERS", "Users"],
                ["VENDORS", "Vendors"],
              ] as const).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={audienceFilter === value}
                  variant={audienceFilter === value ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setAudienceFilter(value);
                    setPage(1);
                  }}
                  className="min-w-0 px-2 text-xs sm:text-sm"
                >
                  {label}
                </Button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <div className="space-y-1.5">
                <Label htmlFor="announcement-search" className="text-xs text-muted-foreground">Search campaigns</Label>
                <Input
                  id="announcement-search"
                  value={searchInput}
                  onChange={(event) => {
                    setSearchInput(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Search title or message"
                  maxLength={120}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="announcement-status" className="text-xs text-muted-foreground">Delivery status</Label>
                <select
                  id="announcement-status"
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value as StatusFilter);
                    setPage(1);
                  }}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="ALL">All statuses</option>
                  <option value="DRAFT">Draft</option>
                  <option value="SCHEDULED">Scheduled</option>
                  <option value="PUBLISHING">Publishing</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="FAILED">Failed</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </div>
            </div>
          </div>

          <div className="max-h-[min(75vh,58rem)] space-y-3 overflow-y-auto p-3 sm:p-5">
            {announcementsQuery.isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading campaigns…</p>
            ) : announcementsQuery.isError ? (
              <div className="rounded-xl border border-destructive/30 p-4">
                <p className="text-sm text-destructive">Could not load announcements.</p>
                <Button type="button" variant="outline" size="sm" onClick={() => void announcementsQuery.refetch()} className="mt-3">Try again</Button>
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
                <p className="font-semibold">No campaigns found</p>
                <p className="mt-1 text-sm text-muted-foreground">Adjust your filters or save a draft to start a campaign.</p>
              </div>
            ) : (
              items.map((announcement) => (
                <CampaignCard
                  key={announcement.id}
                  announcement={announcement}
                  onEdit={() => editAnnouncement(announcement)}
                  onPublish={() => setPendingConfirmation({ kind: "publish-campaign", announcement })}
                  onArchive={() => setPendingConfirmation({ kind: "archive", announcement })}
                  actionsDisabled={anyActionPending}
                />
              ))
            )}
          </div>
          <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="text-xs text-muted-foreground">
              {totalItems === 0
                ? "No matching campaigns"
                : `Showing ${(page - 1) * 20 + 1}–${Math.min(page * 20, totalItems)} of ${totalItems.toLocaleString()}`}
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || announcementsQuery.isFetching}>
                Previous
              </Button>
              <span className="min-w-16 text-center text-xs text-muted-foreground">Page {page} of {pageCount}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page >= pageCount || announcementsQuery.isFetching}>
                Next
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={pendingConfirmation !== null}
        onOpenChange={(open) => {
          if (!open && !isSaving && !anyActionPending) setPendingConfirmation(null);
        }}
        title={confirmationIsPublish
          ? pendingAnnouncement?.status === "FAILED" ? "Retry announcement delivery?" : "Publish announcement now?"
          : "Archive announcement?"}
        description={confirmationIsPublish
          ? `“${pendingConfirmation?.kind === "publish-composer" ? (form.title.trim() || "Untitled announcement") : pendingAnnouncement?.title}” will be delivered as an in-app notification to ${audienceLabel(confirmationAudience ?? "CUSTOMERS").toLowerCase()}${confirmationAudienceSize === undefined ? "" : ` (about ${confirmationAudienceSize.toLocaleString()} active accounts)`}. Publishing starts delivery immediately.`
          : `“${pendingAnnouncement?.title}” will be archived. This keeps its delivery history for audit purposes; notifications already delivered remain in recipient inboxes.`}
        confirmText={confirmationIsPublish
          ? pendingAnnouncement?.status === "FAILED" ? "Retry delivery" : "Publish announcement"
          : "Archive announcement"}
        variant={confirmationIsPublish ? "warning" : "default"}
        isLoading={isSaving || anyActionPending}
        onConfirm={() => {
          const confirmation = pendingConfirmation;
          if (!confirmation) return;
          if (confirmation.kind === "publish-composer") {
            void saveAnnouncement("publish");
          } else if (confirmation.kind === "publish-campaign") {
            setPendingConfirmation(null);
            publishMutation.mutate(confirmation.announcement.id);
          } else {
            setPendingConfirmation(null);
            archiveMutation.mutate(confirmation.announcement.id);
          }
        }}
      />
    </div>
  );
}

function CampaignCard({
  announcement,
  onEdit,
  onPublish,
  onArchive,
  actionsDisabled,
}: {
  announcement: AdminAnnouncement;
  onEdit: () => void;
  onPublish: () => void;
  onArchive: () => void;
  actionsDisabled: boolean;
}) {
  const editable = announcement.status === "DRAFT" || announcement.status === "SCHEDULED";
  const legacyAudience = announcement.audience === "ADMINISTRATORS";
  const canPublish = !legacyAudience && (editable || announcement.status === "FAILED");
  const canArchive = announcement.status !== "ARCHIVED" && announcement.status !== "PUBLISHING";
  const creatorName = announcement.createdByAdmin?.firstName
    ? `${announcement.createdByAdmin.firstName} ${announcement.createdByAdmin.lastName ?? ""}`.trim()
    : announcement.createdByAdmin?.email;

  return (
    <article className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={statusClasses(announcement.status)}>
              {announcement.status.toLowerCase()}
            </Badge>
            <Badge variant="outline">{audienceLabel(announcement.audience)}</Badge>
            <Badge variant="outline">{announcement.priority.toLowerCase()}</Badge>
          </div>
          <h3 className="break-words text-base font-semibold leading-6">{announcement.title}</h3>
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{announcement.message}</p>
        </div>
        <p className="shrink-0 text-xs text-muted-foreground">
          {announcement.status === "PUBLISHED" ? `${announcement.recipientCount.toLocaleString()} reached` : ""}
        </p>
      </div>

      {announcement.lastError && (
        <div className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs leading-5 text-destructive">
          Delivery needs attention: {announcement.lastError}
        </div>
      )}

      {legacyAudience && announcement.status !== "ARCHIVED" && (
        <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-5 text-amber-800 dark:text-amber-200">
          This historical administrator campaign is retained for audit. Edit it and select customers or vendors before reuse.
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-1 text-xs text-muted-foreground sm:grid-cols-2">
        <p>{announcement.status === "SCHEDULED" ? "Scheduled" : "Created"}: {displayDate(announcement.scheduledAt ?? announcement.createdAt)}</p>
        <p>{creatorName ? `Created by ${creatorName}` : "Creator unavailable"}</p>
        {announcement.publishedAt && <p>Published: {displayDate(announcement.publishedAt)}</p>}
        {destinationLabel(announcement) && <p>Destination: {destinationLabel(announcement)}</p>}
      </div>

      <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:flex-wrap sm:justify-end">
        {editable && (
          <Button type="button" variant="outline" size="sm" onClick={onEdit} disabled={actionsDisabled} className="w-full sm:w-auto">Edit</Button>
        )}
        {canPublish && (
          <Button type="button" size="sm" onClick={onPublish} disabled={actionsDisabled} className="w-full sm:w-auto">
            {announcement.status === "FAILED" ? "Retry delivery" : "Publish now"}
          </Button>
        )}
        {canArchive && (
          <Button type="button" variant="ghost" size="sm" onClick={onArchive} disabled={actionsDisabled} className="w-full sm:w-auto">Archive</Button>
        )}
      </div>
    </article>
  );
}
