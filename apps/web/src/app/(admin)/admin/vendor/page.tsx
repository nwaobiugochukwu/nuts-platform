"use client";

import { RemoteImage } from "@/component/ui/RemoteImage";
import { adminVendorService } from "@/api";
import { getApiErrorMessage } from "@/api/core/error";
import type { AdminVendorResponseDto } from "@/api/dto/vendor";
import { ManagementToolbar } from "@/component/common/ManagementToolbar";
import { PageHeader } from "@/component/common/PageHeader";
import { DataTable,type Column } from "@/component/data/DataTable";
import { ConfirmDialog } from "@/component/modal/ConfirmDialog";
import { Badge } from "@/component/ui/badge";
import { Button } from "@/component/ui/button";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { queryKey } from "@/lib/query-key";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import {
Ban,
Check,
ExternalLink,
RotateCcw,
ShieldCheck,
Store,
Trash2,
UserCheck,
} from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { useState } from "react";
import { toast } from "sonner";

type AdminVendor = AdminVendorResponseDto;

export default function AdminVendorPage() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<AdminVendor | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<AdminVendor | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<AdminVendor | null>(null);
  const [approveTarget, setApproveTarget] = useState<AdminVendor | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<AdminVendor | null>(null);

  const qc = useQueryClient();
  const debouncedSearch = useDebouncedValue(search.trim());

  const vendorFilters = [
    { value: "active", label: "Active Merchants" },
    { value: "inactive", label: "Suspended" },
    { value: "approved", label: "Approved" },
    { value: "pending", label: "Pending Approval" },
    { value: "verified", label: "KYC Verified" },
    { value: "unverified", label: "Unverified" },
  ];

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [...queryKey.admin.vendor, debouncedSearch, filter, page],
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      const params: Record<string, string | number | boolean> = {
        page,
        limit: 25,
      };
      if (debouncedSearch) params.search = debouncedSearch;

      if (filter === "active") params.isActive = true;
      if (filter === "inactive") params.isActive = false;
      if (filter === "approved") params.isApproved = true;
      if (filter === "pending") params.isApproved = false;
      if (filter === "verified") params.isVerified = true;
      if (filter === "unverified") params.isVerified = false;

      const res = await adminVendorService.list(params);
      return res;
    },
  });

  const refreshVendors = () => {
    qc.invalidateQueries({ queryKey: queryKey.admin.vendor });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminVendorService.delete(id),
    onSuccess: () => {
      toast.success("Vendor store permanently removed");
      refreshVendors();
      setDeleteTarget(null);
    },
    onError: (err: unknown) =>
      toast.error(getApiErrorMessage(err, "Failed to delete vendor")),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => adminVendorService.approve(id),
    onSuccess: () => {
      toast.success("Vendor approved successfully!");
      refreshVendors();
      setApproveTarget(null);
    },
    onError: (err: unknown) =>
      toast.error(getApiErrorMessage(err, "Failed to approve vendor")),
  });

  const verifyMutation = useMutation({
    mutationFn: (id: string) => adminVendorService.verify(id),
    onSuccess: () => {
      toast.success("Vendor KYC verified successfully!");
      refreshVendors();
      setVerifyTarget(null);
    },
    onError: (err: unknown) =>
      toast.error(getApiErrorMessage(err, "Failed to verify vendor")),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, activate }: { id: string; activate: boolean }) =>
      adminVendorService.setActive(id, activate),
    onSuccess: (_, { activate }) => {
      toast.success(
        activate
          ? "Vendor account reactivated"
          : "Vendor account suspended"
      );
      refreshVendors();
      setSuspendTarget(null);
      setReactivateTarget(null);
    },
    onError: (err: unknown) =>
      toast.error(getApiErrorMessage(err, "Failed to update vendor status")),
  });

  const columns: Column<AdminVendor>[] = [
    {
      header: "Store & Brand",
      key: "storeName",
      render: (r: AdminVendor) => (
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary font-bold text-foreground overflow-hidden">
            {r.storeLogoUrl ? (
              <RemoteImage
                src={r.storeLogoUrl}
                alt={r.storeName}
                className="h-full w-full object-cover"
              />
            ) : (
              <Store className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-foreground flex items-center gap-1.5">
              <span>{r.storeName}</span>
              {r.isVerified && (
                <span title="Verified Merchant">
                  <ShieldCheck className="h-3.5 w-3.5 text-blue-500 inline" />
                </span>
              )}
            </div>
          </div>
        </div>
      ),
    },
    {
      header: "Contact Person",
      key: "firstName",
      render: (r: AdminVendor) => (
        <div>
          <div className="font-medium text-foreground">
            {r.firstName} {r.lastName}
          </div>
          <div className="text-xs text-muted-foreground">{r.email}</div>
          {r.businessPhone && (
            <div className="text-xs text-muted-foreground">{r.businessPhone}</div>
          )}
        </div>
      ),
    },
    {
      header: "Store Verification",
      key: "isVerified",
      render: (r: AdminVendor) => (
        <div className="space-y-1">
          <div>
            {r.isApproved ? (
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 text-xs">
                Approved
              </Badge>
            ) : (
              <Badge variant="outline" className="border-amber-500/30 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 text-xs">
                Pending Approval
              </Badge>
            )}
          </div>
          <div>
            {r.isVerified ? (
              <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400 flex items-center gap-1">
                <Check className="h-3 w-3" /> KYC Verified
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                Unverified KYC
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      header: "Account State",
      key: "isActive",
      render: (r: AdminVendor) => (
        <Badge
          variant="outline"
          className={
            r.isActive
              ? "border-emerald-500/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 text-xs"
              : "border-rose-500/30 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 text-xs"
          }
        >
          {r.isActive ? "Active" : "Suspended"}
        </Badge>
      ),
    },
    {
      header: "Actions",
      key: "id",
      render: (r: AdminVendor) => (
        <div className="flex items-center gap-1">
          <Link
            href={`/vendor/${r.storeSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            title="View public storefront"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>

          {!r.isApproved && (
            <Button
              variant="ghost"
              size="sm"
              title="Approve vendor"
              className="h-8 w-8 p-0 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
              onClick={() => setApproveTarget(r)}
            >
              <UserCheck className="h-3.5 w-3.5" />
            </Button>
          )}

          {!r.isVerified && (
            <Button
              variant="ghost"
              size="sm"
              title="Verify KYC"
              className="h-8 w-8 p-0 rounded-lg text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30"
              onClick={() => setVerifyTarget(r)}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
            </Button>
          )}

          {r.isActive ? (
            <Button
              variant="ghost"
              size="sm"
              title="Suspend vendor store"
              className="h-8 w-8 p-0 rounded-lg text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30"
              onClick={() => setSuspendTarget(r)}
            >
              <Ban className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              title="Reactivate store"
              className="h-8 w-8 p-0 rounded-lg text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
              onClick={() => setReactivateTarget(r)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            title="Permanently delete vendor"
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
        title="Vendor Directory"
        description="Onboard merchants, authorize storefronts, and manage KYC compliance."
      />

      <ManagementToolbar
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Search store, contact name, or email..."
        filterValue={filter}
        onFilterChange={(v) => {
          setFilter(v);
          setPage(1);
        }}
        filters={vendorFilters}
        onRefresh={refreshVendors}
        isLoading={isLoading || isFetching}
      />

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isFetching={isFetching}
        emptyMessage="No vendor accounts found."
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

      {/* CONFIRM SUSPEND DIALOG */}
      <ConfirmDialog
        open={Boolean(suspendTarget)}
        onOpenChange={(v) => !v && setSuspendTarget(null)}
        title="Suspend Vendor Store"
        description={
          <>
            Suspend vendor <strong>&quot;{suspendTarget?.storeName}&quot;</strong>? Their listed
            products will be temporarily hidden from customer search and category browsing.
          </>
        }
        confirmText="Suspend Store"
        variant="warning"
        isLoading={toggleActiveMutation.isPending}
        onConfirm={() =>
          suspendTarget &&
          toggleActiveMutation.mutate({ id: suspendTarget.id, activate: false })
        }
      />

      {/* CONFIRM DELETE DIALOG */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="Delete Vendor Store"
        description={
          <>
            Permanently delete vendor account <strong>&quot;{deleteTarget?.storeName}&quot;</strong> (
            {deleteTarget?.email})? All associated product inventory and wallet balances
            will be archived.
          </>
        }
        confirmText="Delete Permanently"
        variant="destructive"
        isLoading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />

      {/* CONFIRM APPROVE DIALOG */}
      <ConfirmDialog
        open={Boolean(approveTarget)}
        onOpenChange={(v) => !v && setApproveTarget(null)}
        title="Approve Vendor Store"
        description={
          <>
            Are you sure you want to approve store <strong>&quot;{approveTarget?.storeName}&quot;</strong> (
            {approveTarget?.email})? This grants the merchant permission to list catalog inventory and receive customer orders.
          </>
        }
        confirmText="Approve Vendor"
        variant="default"
        isLoading={approveMutation.isPending}
        onConfirm={() => approveTarget && approveMutation.mutate(approveTarget.id)}
      />

      {/* CONFIRM VERIFY KYC DIALOG */}
      <ConfirmDialog
        open={Boolean(verifyTarget)}
        onOpenChange={(v) => !v && setVerifyTarget(null)}
        title="Verify KYC Compliance"
        description={
          <>
            Confirm that you have reviewed identity documents for <strong>&quot;{verifyTarget?.storeName}&quot;</strong> and verified regulatory KYC compliance?
          </>
        }
        confirmText="Mark as Verified"
        variant="default"
        isLoading={verifyMutation.isPending}
        onConfirm={() => verifyTarget && verifyMutation.mutate(verifyTarget.id)}
      />

      {/* CONFIRM REACTIVATE STORE DIALOG */}
      <ConfirmDialog
        open={Boolean(reactivateTarget)}
        onOpenChange={(v) => !v && setReactivateTarget(null)}
        title="Reactivate Vendor Store"
        description={
          <>
            Reactivate vendor account <strong>&quot;{reactivateTarget?.storeName}&quot;</strong>? Their catalog listings will immediately be restored to marketplace search and browsing.
          </>
        }
        confirmText="Reactivate Account"
        variant="default"
        isLoading={toggleActiveMutation.isPending}
        onConfirm={() =>
          reactivateTarget &&
          toggleActiveMutation.mutate({ id: reactivateTarget.id, activate: true })
        }
      />
    </div>
  );
}
