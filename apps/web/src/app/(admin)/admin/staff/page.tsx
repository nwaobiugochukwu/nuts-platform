"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  UserPlus,
  RefreshCw,
  Search,
  History,
  Users,
} from "lucide-react";
import {
  adminGovernanceService,
  type AdminStaffMember,
  type GovernanceAuditLog,
} from "@/api";
import { PageHeader } from "@/component/common/PageHeader";
import { DataTable, type Column } from "@/component/data/DataTable";
import { ConfirmDialog } from "@/component/modal/ConfirmDialog";
import { Badge } from "@/component/ui/badge";
import { Button } from "@/component/ui/button";
import { Input } from "@/component/ui/input";
import { Label } from "@/component/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/component/ui/dialog";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { queryKey } from "@/lib/query-key";
import { getApiErrorMessage } from "@/api/core/error";

export default function AdminStaffPage() {
  const [activeTab, setActiveTab] = useState<"staff" | "audit">("staff");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState<AdminStaffMember | null>(null);

  // Create form state
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");

  const qc = useQueryClient();
  const debouncedSearch = useDebouncedValue(search.trim());

  // Staff members query
  const { data: staffData, isLoading: staffLoading, isFetching: staffFetching } = useQuery({
    queryKey: [...queryKey.admin.staff, debouncedSearch, page],
    staleTime: 1000 * 60 * 3,
    queryFn: () =>
      adminGovernanceService.getStaffList({
        page,
        limit: 20,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      }),
    enabled: activeTab === "staff",
  });

  // Audit logs query
  const {
    data: auditLogs,
    isLoading: auditLoading,
    refetch: refetchAudit,
    isFetching: auditFetching,
  } = useQuery({
    queryKey: ["admin", "governance", "audit-logs"],
    staleTime: 1000 * 60 * 2,
    queryFn: () => adminGovernanceService.getAuditLogs(50),
    enabled: activeTab === "audit",
  });

  // Create staff mutation
  const createStaffMutation = useMutation({
    mutationFn: () =>
      adminGovernanceService.createStaff({
        email: newEmail.trim(),
        password: newPassword,
        firstName: newFirstName.trim() || undefined,
        lastName: newLastName.trim() || undefined,
      }),
    onSuccess: (created) => {
      toast.success(`Admin staff ${created.email} created successfully`);
      qc.invalidateQueries({ queryKey: queryKey.admin.staff });
      setIsCreateOpen(false);
      setNewEmail("");
      setNewPassword("");
      setNewFirstName("");
      setNewLastName("");
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, "Failed to create admin staff member"));
    },
  });

  // Toggle status mutation
  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, nextActive }: { id: string; nextActive: boolean }) =>
      adminGovernanceService.updateStaffStatus(id, nextActive),
    onSuccess: (updated) => {
      toast.success(
        `Admin ${updated.email} is now ${updated.isActive ? "active" : "deactivated"}`,
      );
      qc.invalidateQueries({ queryKey: queryKey.admin.staff });
      setStatusTarget(null);
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, "Failed to update staff status"));
      setStatusTarget(null);
    },
  });

  const staffColumns: Column<AdminStaffMember>[] = [
    {
      key: "staff",
      header: "Staff Member",
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-semibold text-foreground">
            {row.firstName || row.lastName
              ? `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim()
              : "Unnamed Admin"}
          </span>
          <span className="text-xs text-muted-foreground">{row.email}</span>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (row) => (
        <Badge variant="outline" className="font-mono text-xs uppercase">
          {row.role}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge variant={row.isActive ? "default" : "destructive"}>
          {row.isActive ? "Active" : "Deactivated"}
        </Badge>
      ),
    },
    {
      key: "createdAt",
      header: "Created",
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.createdAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      className: "text-right",
      render: (row) => (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant={row.isActive ? "destructive" : "outline"}
            onClick={() => setStatusTarget(row)}
            className="text-xs h-8"
          >
            {row.isActive ? "Deactivate" : "Activate"}
          </Button>
        </div>
      ),
    },
  ];

  const auditColumns: Column<GovernanceAuditLog>[] = [
    {
      key: "createdAt",
      header: "Timestamp",
      render: (row) => (
        <span className="text-xs font-mono text-muted-foreground">
          {new Date(row.createdAt).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
      ),
    },
    {
      key: "action",
      header: "Action",
      render: (row) => (
        <Badge variant="secondary" className="font-mono text-xs">
          {row.action}
        </Badge>
      ),
    },
    {
      key: "entity",
      header: "Target Entity",
      render: (row) => (
        <span className="text-xs font-medium text-foreground">
          {row.entity} {row.entityId ? `(#${row.entityId.slice(0, 8)})` : ""}
        </span>
      ),
    },
    {
      key: "adminId",
      header: "Actor Admin",
      render: (row) => (
        <span className="text-xs text-muted-foreground font-mono">
          {row.adminId ? row.adminId.slice(0, 8) : "System"}
        </span>
      ),
    },
    {
      key: "ipAddress",
      header: "IP Address",
      render: (row) => (
        <span className="text-xs text-muted-foreground font-mono">
          {row.ipAddress || "Internal"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="Staff & Platform Governance"
          description="Manage root administrator accounts, control access privileges, and review critical audit trails."
        />
        {activeTab === "staff" && (
          <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
            <UserPlus className="h-4 w-4" />
            Add Staff Member
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab("staff")}
          className={`flex items-center gap-2 px-4 py-2.5 font-medium text-sm transition-colors border-b-2 -mb-px ${
            activeTab === "staff"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Users className="h-4 w-4" />
          Staff Members
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("audit")}
          className={`flex items-center gap-2 px-4 py-2.5 font-medium text-sm transition-colors border-b-2 -mb-px ${
            activeTab === "audit"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <History className="h-4 w-4" />
          Governance Audit Logs
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "staff" ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search staff by email or name..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-9"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => qc.invalidateQueries({ queryKey: queryKey.admin.staff })}
              disabled={staffFetching}
              title="Refresh staff"
            >
              <RefreshCw className={`h-4 w-4 ${staffFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>

          <DataTable
            columns={staffColumns}
            data={staffData?.items || []}
            isLoading={staffLoading}
            isFetching={staffFetching}
            emptyMessage="No administrative staff members found matching your search."
            pagination={{
              page,
              limit: staffData?.limit ?? 20,
              total: staffData?.total ?? 0,
              onPageChange: (newPage) => setPage(newPage),
            }}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              Showing the latest 50 platform governance, staff mutation, and config changes.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchAudit()}
              disabled={auditFetching}
              className="gap-2"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${auditFetching ? "animate-spin" : ""}`} />
              Refresh Logs
            </Button>
          </div>

          <DataTable
            columns={auditColumns}
            data={auditLogs || []}
            isLoading={auditLoading}
            isFetching={auditFetching}
            emptyMessage="No governance audit log entries recorded yet."
          />
        </div>
      )}

      {/* Create Staff Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Admin Staff Member</DialogTitle>
            <DialogDescription>
              Create an administrative user with elevated governance privileges.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newEmail || !newPassword) {
                toast.error("Email and password are required");
                return;
              }
              if (newPassword.length < 8) {
                toast.error("Password must be at least 8 characters");
                return;
              }
              createStaffMutation.mutate();
            }}
            className="space-y-4 py-2"
          >
            <div className="space-y-1.5">
              <Label htmlFor="staff-email">Email Address *</Label>
              <Input
                id="staff-email"
                type="email"
                placeholder="staff.ops@nuts.dev"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="staff-password">Temporary Password *</Label>
              <Input
                id="staff-password"
                type="password"
                placeholder="Minimum 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="staff-firstname">First Name</Label>
                <Input
                  id="staff-firstname"
                  placeholder="Ada"
                  value={newFirstName}
                  onChange={(e) => setNewFirstName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="staff-lastname">Last Name</Label>
                <Input
                  id="staff-lastname"
                  placeholder="Lovelace"
                  value={newLastName}
                  onChange={(e) => setNewLastName(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createStaffMutation.isPending}>
                {createStaffMutation.isPending ? "Creating..." : "Create Staff"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Status Toggle Confirm Dialog */}
      <ConfirmDialog
        open={Boolean(statusTarget)}
        onOpenChange={(open) => !open && setStatusTarget(null)}
        title={statusTarget?.isActive ? "Deactivate Admin Staff?" : "Activate Admin Staff?"}
        description={
          statusTarget?.isActive
            ? `Deactivating ${statusTarget.email} will immediately revoke their active sessions and prevent further administrative login.`
            : `Activating ${statusTarget?.email} will restore their administrative login privileges.`
        }
        confirmText={statusTarget?.isActive ? "Deactivate" : "Activate"}
        variant={statusTarget?.isActive ? "destructive" : "default"}
        isLoading={toggleStatusMutation.isPending}
        onConfirm={() => {
          if (statusTarget) {
            toggleStatusMutation.mutate({
              id: statusTarget.id,
              nextActive: !statusTarget.isActive,
            });
          }
        }}
      />
    </div>
  );
}

