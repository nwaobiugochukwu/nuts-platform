"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { adminGovernanceService, type PlatformConfig } from "@/api";
import { PageHeader } from "@/component/common/PageHeader";
import { Button } from "@/component/ui/button";
import { Card } from "@/component/ui/card";
import { Badge } from "@/component/ui/badge";
import { Label } from "@/component/ui/label";
import { queryKey } from "@/lib/query-key";
import { getApiErrorMessage } from "@/api/core/error";

interface ControlToggleProps {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ControlToggle({
  id,
  title,
  description,
  checked,
  onChange,
}: ControlToggleProps) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div className="min-w-0 space-y-1">
        <Label htmlFor={id} className="text-sm font-semibold sm:text-base">
          {title}
        </Label>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 shrink-0 cursor-pointer accent-primary sm:ml-6"
        aria-label={title}
      />
    </div>
  );
}

export default function AdminPlatformPage() {
  const queryClient = useQueryClient();
  const overviewQuery = useQuery({
    queryKey: [...queryKey.admin.platform, "overview"],
    staleTime: 1000 * 60 * 3,
    queryFn: () => adminGovernanceService.getSystemOverview(),
  });
  const configQuery = useQuery({
    queryKey: [...queryKey.admin.platform, "config"],
    staleTime: 1000 * 60 * 5,
    queryFn: () => adminGovernanceService.getPlatformConfig(),
  });

  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState("");
  const [allowRegistrations, setAllowRegistrations] = useState(true);
  const [allowVendorRegistrations, setAllowVendorRegistrations] = useState(true);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    const config = configQuery.data;
    if (!config) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || isDirty) return;
      setMaintenanceMode(config.maintenanceMode ?? false);
      setMaintenanceMessage(config.maintenanceMessage ?? "");
      setAllowRegistrations(config.allowRegistrations ?? true);
      setAllowVendorRegistrations(config.allowVendorRegistrations ?? true);
      setIsDirty(false);
    });

    return () => {
      cancelled = true;
    };
  }, [configQuery.data, isDirty]);

  const updateMutation = useMutation({
    mutationFn: (payload: Partial<PlatformConfig>) =>
      adminGovernanceService.updatePlatformConfig(payload),
    onSuccess: (saved) => {
      queryClient.setQueryData([...queryKey.admin.platform, "config"], saved);
      setIsDirty(false);
      toast.success("Platform controls saved");
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Could not save platform controls"));
    },
  });

  function saveControls(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateMutation.mutate({
      maintenanceMode,
      maintenanceMessage: maintenanceMessage.trim() || null,
      allowRegistrations,
      allowVendorRegistrations,
    });
  }

  const overview = overviewQuery.data;
  const refreshing = overviewQuery.isFetching || configQuery.isFetching;
  const stats = [
    { label: "Customers", value: overview?.usersCount },
    { label: "Active vendors", value: overview?.vendorsCount },
    { label: "Catalog products", value: overview?.productsCount },
    { label: "Orders", value: overview?.ordersCount },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 sm:space-y-8">
      <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <PageHeader
          title="Platform Controls"
          description="Manage service availability, account registration, and platform-wide settings."
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void overviewQuery.refetch();
            void configQuery.refetch();
          }}
          disabled={refreshing}
          className="w-full sm:w-auto"
        >
          {refreshing ? "Refreshing…" : "Refresh overview"}
        </Button>
      </div>

      <section aria-label="Platform overview" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 sm:gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="min-w-0 p-4 sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {stat.label}
            </p>
            <p className="mt-2 break-words text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {overviewQuery.isLoading
                ? "—"
                : (stat.value?.toLocaleString() ?? "—")}
            </p>
          </Card>
        ))}
      </section>

      {maintenanceMode && (
        <div
          role="status"
          className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm leading-6 text-destructive"
        >
          <span className="font-semibold">Maintenance mode is on.</span> Customer and vendor requests are currently restricted.
        </div>
      )}

      <Card className="min-w-0 overflow-hidden border-border p-4 shadow-xs sm:p-6 lg:p-8">
        <div className="flex flex-col gap-2 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
              Runtime controls
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              Changes are applied across the platform without a service restart.
            </p>
          </div>
          {configQuery.data?.updatedAt && (
            <Badge variant="outline" className="w-fit shrink-0 font-mono text-xs">
              Saved {new Date(configQuery.data.updatedAt).toLocaleString()}
            </Badge>
          )}
        </div>

        <form onSubmit={saveControls} className="space-y-4 pt-5 sm:space-y-5">
          <ControlToggle
            id="maintenance-toggle"
            title="Maintenance mode"
            description="Restrict customer and vendor traffic while administrators and health checks remain available."
            checked={maintenanceMode}
            onChange={(checked) => {
              setMaintenanceMode(checked);
              setIsDirty(true);
            }}
          />
          <ControlToggle
            id="customer-registration-toggle"
            title="Customer registration"
            description="Allow new customers to create shopping accounts."
            checked={allowRegistrations}
            onChange={(checked) => {
              setAllowRegistrations(checked);
              setIsDirty(true);
            }}
          />
          <ControlToggle
            id="vendor-registration-toggle"
            title="Vendor onboarding"
            description="Allow new merchants to submit stores for administrative review."
            checked={allowVendorRegistrations}
            onChange={(checked) => {
              setAllowVendorRegistrations(checked);
              setIsDirty(true);
            }}
          />

          <div className="space-y-2 pt-2">
            <Label htmlFor="maintenance-message" className="text-sm font-semibold">
              Maintenance message
            </Label>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              Shown on blocked requests while maintenance mode is enabled. For customer or administrator announcements, use the dedicated <Link href="/admin/announcements" className="font-semibold text-primary underline underline-offset-4">Announcements</Link> workspace.
            </p>
            <textarea
              id="maintenance-message"
              maxLength={500}
              rows={3}
              value={maintenanceMessage}
              onChange={(event) => {
                setMaintenanceMessage(event.target.value);
                setIsDirty(true);
              }}
              placeholder="We are performing scheduled maintenance. Please try again shortly."
              className="flex min-h-24 w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm leading-6 shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="text-right text-xs text-muted-foreground">
              {maintenanceMessage.length}/500
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-muted-foreground" aria-live="polite">
              {isDirty ? "Unsaved platform changes" : "All platform controls are saved"}
            </p>
            <Button
              type="submit"
              disabled={!isDirty || updateMutation.isPending}
              className="w-full sm:w-auto sm:min-w-40"
            >
              {updateMutation.isPending ? "Saving…" : "Save controls"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
