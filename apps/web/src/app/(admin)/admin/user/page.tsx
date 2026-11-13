"use client";

import { adminUserService } from "@/api";
import { getApiErrorMessage } from "@/api/core/error";
import type { AdminUserResponseDto } from "@/api/dto/user";
import { ManagementToolbar } from "@/component/common/ManagementToolbar";
import { PageHeader } from "@/component/common/PageHeader";
import { DataTable,type Column } from "@/component/data/DataTable";
import { OtpPromptDialog } from "@/component/modal/OtpPromptDialog";
import { Badge } from "@/component/ui/badge";
import { Button } from "@/component/ui/button";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { queryKey } from "@/lib/query-key";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import {
Ban,
RotateCcw,
Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type AdminUser = AdminUserResponseDto;

function formatSuspensionInfo(reasonStr: string | null | undefined) {
  if (!reasonStr) return { text: "Administrative suspension", until: null };
  const match = reasonStr.match(/^\[SUSPENSION\|until:([^\]]+)\]\s*([\s\S]*)$/);
  if (match) {
    const rawUntil = match[1];
    const cleanReason = match[2] || "Administrative suspension";
    if (!rawUntil || rawUntil === "indefinite") {
      return { text: cleanReason, until: "Indefinite" };
    }
    const d = new Date(rawUntil);
    if (!isNaN(d.getTime())) {
      return {
        text: cleanReason,
        until: d.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      };
    }
  }
  return { text: reasonStr, until: "Indefinite" };
}

export default function AdminUserPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [suspendTarget, setSuspendTarget] = useState<AdminUser | null>(null);
  const [unsuspendTarget, setUnsuspendTarget] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  const qc = useQueryClient();
  const debouncedSearch = useDebouncedValue(search.trim());

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [...queryKey.admin.user, debouncedSearch, status, page],
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      const res = await adminUserService.list({
        page,
        limit: 25,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(status ? { status } : {}),
      });
      return res;
    },
  });

  const refreshUsers = () => {
    qc.invalidateQueries({ queryKey: queryKey.admin.user });
  };

  const unsuspendMutation = useMutation({
    mutationFn: ({ id, otpCode }: { id: string; otpCode: string }) =>
      adminUserService.unsuspend(id, otpCode),
    onSuccess: () => {
      toast.success("User account unsuspended and access restored");
      refreshUsers();
      setUnsuspendTarget(null);
    },
    onError: (e) =>
      toast.error(getApiErrorMessage(e, "Unable to unsuspend user")),
  });

  const suspendMutation = useMutation({
    mutationFn: ({
      id,
      otpCode,
      reason,
      duration,
    }: {
      id: string;
      otpCode: string;
      reason: string;
      duration?: string;
    }) => adminUserService.suspend(id, { reason, duration }, otpCode),
    onSuccess: () => {
      toast.success("User account suspended");
      refreshUsers();
      setSuspendTarget(null);
    },
    onError: (e) =>
      toast.error(getApiErrorMessage(e, "Unable to suspend user")),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, otpCode }: { id: string; otpCode: string }) =>
      adminUserService.delete(id, otpCode),
    onSuccess: () => {
      toast.success("User account deleted successfully");
      refreshUsers();
      setDeleteTarget(null);
    },
    onError: (e) =>
      toast.error(getApiErrorMessage(e, "Unable to delete user")),
  });

  const columns: Column<AdminUser>[] = [
    {
      key: "email",
      header: "User Identity",
      render: (r) => {
        const initials =
          (r.firstName?.[0] || r.email?.[0] || "U").toUpperCase() +
          (r.lastName?.[0] || "").toUpperCase();
        return (
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 dark:bg-neutral-800 text-xs font-semibold text-neutral-800 dark:text-neutral-200">
              {initials}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-semibold text-neutral-900 dark:text-white truncate">
                {r.email}
              </span>
              <span className="text-xs text-neutral-400">
                {r.firstName || r.lastName
                  ? `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim()
                  : "Unspecified Name"}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      key: "isActive",
      header: "Account State",
      render: (r) => {
        if (r.isActive) {
          return (
            <Badge variant="success" className="text-xs font-semibold">
              Active
            </Badge>
          );
        }
        const info = formatSuspensionInfo(r.deactivationReason);
        return (
          <div className="flex flex-col gap-0.5">
            <Badge variant="destructive" className="text-xs font-semibold w-fit">
              Suspended
            </Badge>
            <span
              className="text-[11px] text-muted-foreground truncate max-w-[200px]"
              title={info.text}
            >
              {info.until ? `Until: ${info.until}` : info.text}
            </span>
          </div>
        );
      },
    },
    {
      key: "createdAt",
      header: "Joined Date",
      render: (r) => (
        <span className="text-xs text-neutral-400">
          {new Date(r.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (r) => (
        <div className="flex items-center gap-1">
          {r.isActive ? (
            <Button
              variant="ghost"
              size="sm"
              title="Suspend user account (requires OTP)"
              className="h-8 w-8 p-0 rounded-lg text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30"
              onClick={() => setSuspendTarget(r)}
            >
              <Ban className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              title="Unsuspend user account (requires OTP)"
              className="h-8 w-8 p-0 rounded-lg text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
              onClick={() => setUnsuspendTarget(r)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            title="Delete user account (requires OTP)"
            className="h-8 w-8 p-0 rounded-lg text-rose-500 hover:bg-rose-500/10 hover:text-rose-600"
            onClick={() => setDeleteTarget(r)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Accounts"
        description="Search customer and vendor directories, manage credentials, and audit privileges."
      />

      <ManagementToolbar
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Search account email, customer name, or phone..."
        filterValue={status}
        onFilterChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
        filters={[
          { value: "ACTIVE", label: "Active Accounts" },
          { value: "SUSPENDED", label: "Suspended Accounts" },
        ]}
        onRefresh={refreshUsers}
        isLoading={isLoading || isFetching}
      />

      <DataTable
        columns={columns}
        data={Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []}
        isLoading={isLoading}
        isFetching={isFetching}
        emptyMessage="No user accounts matched your search criteria."
        pagination={
          data?.meta
            ? {
                page: data.meta.page ?? page,
                limit: data.meta.limit ?? 25,
                total: data.meta.totalItems ?? data.meta.total ?? 0,
                totalPages: data.meta.totalPages,
                hasNextPage: data.meta.hasNextPage,
                hasPrevPage: data.meta.hasPreviousPage,
                onPageChange: (newPage) => setPage(newPage),
              }
            : undefined
        }
      />

      {/* SECURE SUSPEND MODAL (WITH DURATION + REASON + OTP) */}
      <OtpPromptDialog
        open={Boolean(suspendTarget)}
        onOpenChange={(v) => !v && setSuspendTarget(null)}
        title="Suspend User Account"
        description={`Suspending "${suspendTarget?.email}" revokes all active sessions and blocks platform access until the suspension duration elapses.`}
        requireDuration={true}
        durationLabel="Suspension Period"
        requireReason={true}
        reasonLabel="Reason for account suspension"
        reasonPlaceholder="e.g. Terms of Service violation, security incident, chargeback abuse..."
        confirmText="Confirm Suspension"
        isLoading={suspendMutation.isPending}
        onRequestOtp={async () => {
          await adminUserService.requestOtp();
          toast.success("Security verification code sent to your admin email.");
        }}
        onSubmit={({ otpCode, reason, duration }) => {
          if (suspendTarget && reason) {
            suspendMutation.mutate({
              id: suspendTarget.id,
              otpCode,
              reason,
              duration,
            });
          }
        }}
      />

      {/* SECURE UNSUSPEND MODAL (WITH OTP) */}
      <OtpPromptDialog
        open={Boolean(unsuspendTarget)}
        onOpenChange={(v) => !v && setUnsuspendTarget(null)}
        title="Unsuspend User Account"
        description={`Unsuspending "${unsuspendTarget?.email}" restores full platform access. Requires your administrative 2FA security key.`}
        requireReason={false}
        confirmText="Confirm Unsuspension"
        isLoading={unsuspendMutation.isPending}
        onRequestOtp={async () => {
          await adminUserService.requestOtp();
          toast.success("Security verification code sent to your admin email.");
        }}
        onSubmit={({ otpCode }) => {
          if (unsuspendTarget) {
            unsuspendMutation.mutate({
              id: unsuspendTarget.id,
              otpCode,
            });
          }
        }}
      />

      {/* SECURE DELETE MODAL (WITH OTP) */}
      <OtpPromptDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="Delete User Account"
        description={`Deleting "${deleteTarget?.email}" will permanently revoke all active sessions and block access. Requires your 2FA security key.`}
        requireReason={false}
        confirmText="Delete Account"
        isLoading={deleteMutation.isPending}
        onRequestOtp={async () => {
          await adminUserService.requestOtp();
          toast.success("Security verification code sent to your admin email.");
        }}
        onSubmit={({ otpCode }) => {
          if (deleteTarget) {
            deleteMutation.mutate({
              id: deleteTarget.id,
              otpCode,
            });
          }
        }}
      />
    </div>
  );
}
