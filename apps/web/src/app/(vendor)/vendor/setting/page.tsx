"use client";

import { vendorAccountService } from "@/api";
import { getApiErrorMessage } from "@/api/core/error";
import { FormInput } from "@/component/form/FormInput";
import { ImageUpload } from "@/component/form/ImageUpload";
import { FormTextarea } from "@/component/form/FormTextarea";
import { ConfirmDialog } from "@/component/modal/ConfirmDialog";
import { ThemeSelector } from "@/component/theme/ThemeSelector";
import { Badge } from "@/component/ui/badge";
import { Button } from "@/component/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/component/ui/card";
import { useAuthStore } from "@/zustand/auth";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import {
AlertTriangle,
Bell,
ExternalLink,
Lock,
Palette,
Save,
Store,
Trash2
} from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { useState } from "react";
import { FormProvider,useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { NotificationPreferencesContent } from "@/components/domain/notification/NotificationPreferencesView";

const storeSchema = z.object({
  storeName: z.string().min(2, "Store name is required"),
  storeDescription: z.string().min(5, "Store description is required"),
  businessPhone: z
    .string()
    .regex(
      /^\+[1-9]\d{6,14}$/,
      "Phone number must include international country code (e.g. +2349064786655)",
    ),
  businessEmail: z.string().email("Valid business email is required"),
  firstName: z.string().max(100).optional().or(z.literal("")),
  lastName: z.string().max(100).optional().or(z.literal("")),
  storeLogoUrl: z.string().max(500).optional().or(z.literal("")),
});

type StoreFormData = z.infer<typeof storeSchema>;

export default function VendorSettingPage() {
  const qc = useQueryClient();
  const logout = useAuthStore((state) => state.logout);
  const [activeTab, setActiveTab] = useState<"store" | "theme" | "notifications" | "danger">("store");
  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const { data: vendor, isLoading } = useQuery({
    queryKey: ["vendor", "account"],
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 15,
    queryFn: async () => (await vendorAccountService.getAccount()).data,
  });

  const methods = useForm<StoreFormData>({
    resolver: zodResolver(storeSchema),
    values: {
      storeName: vendor?.storeName ?? "",
      storeDescription: vendor?.storeDescription ?? "",
      businessPhone: vendor?.businessPhone ?? "",
      businessEmail: vendor?.businessEmail ?? "",
      firstName: vendor?.firstName ?? "",
      lastName: vendor?.lastName ?? "",
      storeLogoUrl: vendor?.storeLogoUrl ?? "",
    },
    disabled: !vendor,
  });

  const updateMutation = useMutation({
    mutationFn: (data: StoreFormData) => vendorAccountService.update(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendor", "account"] });
      toast.success("Store details updated successfully");
    },
    onError: (err: unknown) =>
      toast.error(getApiErrorMessage(err, "Failed to update store details")),
  });

  const deactivateMutation = useMutation({
    mutationFn: () => vendorAccountService.deactivate(),
    onSuccess: async () => {
      setIsDeactivateOpen(false);
      toast.success("Vendor store deactivated");
      await logout({ skipApi: true, redirectTo: "/auth/login" });
    },
    onError: (err: unknown) =>
      toast.error(getApiErrorMessage(err, "Failed to deactivate store")),
  });

  const deleteMutation = useMutation({
    mutationFn: () => vendorAccountService.deleteAccount(),
    onSuccess: async () => {
      setIsDeleteOpen(false);
      toast.success("Vendor account permanently deleted");
      await logout({ skipApi: true, redirectTo: "/auth/login" });
    },
    onError: (err: unknown) =>
      toast.error(getApiErrorMessage(err, "Failed to delete account")),
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 space-y-4">
        <div className="h-48 animate-pulse rounded-3xl bg-neutral-100 dark:bg-neutral-900" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        {/* Tab Controls */}
        <div className="flex gap-2 border-b border-border pb-4 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab("store")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all ${
              activeTab === "store"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
          >
            <Store className="h-4 w-4" />
            <span>Store Profile</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("theme")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all ${
              activeTab === "theme"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
          >
            <Palette className="h-4 w-4" />
            <span>Appearance & Theme</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("notifications")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all ${
              activeTab === "notifications"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
          >
            <Bell className="h-4 w-4" />
            <span>Notification Preferences</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("danger")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all ${
              activeTab === "danger"
                ? "bg-destructive text-destructive-foreground shadow-xs"
                : "text-destructive hover:bg-destructive/10"
            }`}
          >
            <AlertTriangle className="h-4 w-4" />
            <span>Store Lifecycle</span>
          </button>
        </div>

        {/* Tab 1: Store Profile */}
        {activeTab === "store" && (
          <div className="max-w-2xl space-y-6">
            <Card className="rounded-2xl border-neutral-200/80 dark:border-neutral-800">
              <CardHeader className="flex flex-row items-center justify-between pb-4">
                <div>
                  <CardTitle className="text-base font-bold">Store Brand & Contacts</CardTitle>
                  <CardDescription className="text-sm">
                    Information displayed publicly across your storefront
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={vendor?.isApproved ? "success" : "secondary"} className="text-xs font-semibold">
                    {vendor?.isApproved ? "Approved Store" : "Pending Approval"}
                  </Badge>
                  {vendor?.isVerified && (
                    <Badge variant="outline" className="text-xs font-semibold text-emerald-500 border-emerald-500/30">
                      Verified
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                  {vendor?.storeSlug && (
                    <div className="mb-4 flex justify-end">
                      <Link
                        href={`/vendor/${vendor.storeSlug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-primary transition-colors hover:bg-secondary"
                      >
                        Visit store <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  )}

                  <FormProvider {...methods}>
                    <form
                      onSubmit={methods.handleSubmit((data) => updateMutation.mutate(data))}
                      className="space-y-4"
                    >
                      <div className="space-y-4">
                        <FormInput
                          name="storeName"
                          label="Store Name"
                          placeholder="e.g. Obsidian Leatherworks"
                        />
                        <ImageUpload
                          name="storeLogoUrl"
                          label="Store Logo Image"
                          authRole="vendor"
                          single={true}
                          maxImages={1}
                          aspectHint="square (1:1 recommended)"
                        />
                      </div>

                      <FormTextarea
                        name="storeDescription"
                        label="Store Bio / Description"
                        placeholder="Tell customers about your bespoke craftsmanship and collections..."
                        rows={3}
                      />

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <FormInput
                          name="firstName"
                          label="Contact First Name"
                          placeholder="First name"
                        />
                        <FormInput
                          name="lastName"
                          label="Contact Last Name"
                          placeholder="Last name"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <FormInput
                          name="businessEmail"
                          label="Public Business Email"
                          type="email"
                          placeholder="contact@brand.com"
                        />
                        <FormInput
                          name="businessPhone"
                          label="Customer Inquiries Phone"
                          placeholder="+2349064786655"
                        />
                      </div>

                      <div className="pt-2 flex justify-end">
                        <Button
                          type="submit"
                          disabled={updateMutation.isPending}
                          className="rounded-xl px-5 py-2.5 text-xs font-bold bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 shadow-xs flex items-center gap-2"
                        >
                          <Save className="h-3.5 w-3.5" />
                          <span>{updateMutation.isPending ? "Saving..." : "Save Store Details"}</span>
                        </Button>
                      </div>
                    </form>
                  </FormProvider>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tab 2: Appearance & Theme */}
        {activeTab === "theme" && (
          <div className="max-w-2xl">
            <Card className="rounded-2xl border-neutral-200/80 dark:border-neutral-800">
              <CardHeader>
                <CardTitle className="text-base font-bold">Store Dashboard Appearance</CardTitle>
                <CardDescription className="text-xs">
                  Switch between luxury light and dark themes tailored for vendor analytics and catalog workflows.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ThemeSelector showTitle={false} />
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tab: Notification Preferences */}
        {activeTab === "notifications" && (
          <div className="max-w-2xl">
            <NotificationPreferencesContent />
          </div>
        )}

        {/* Tab 3: Store Lifecycle */}
        {activeTab === "danger" && (
          <div className="max-w-2xl space-y-6">
            <Card className="rounded-2xl border-amber-200 dark:border-amber-950/40 bg-amber-50/30 dark:bg-amber-950/10">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
                    <Lock className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base text-amber-900 dark:text-amber-300">
                      Deactivate Store
                    </CardTitle>
                    <CardDescription className="text-xs text-amber-700/80 dark:text-amber-400/80">
                      Temporarily pause your storefront listings and access.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Deactivating unpublishes your store and halts incoming orders until you sign back in.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsDeactivateOpen(true)}
                  className="rounded-xl border-amber-300 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-300 text-xs font-semibold"
                >
                  Deactivate Store
                </Button>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-rose-200 dark:border-rose-950/40 bg-rose-50/30 dark:bg-rose-950/10">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/10 text-rose-600">
                    <Trash2 className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base text-rose-900 dark:text-rose-300">
                      Permanently Delete Store
                    </CardTitle>
                    <CardDescription className="text-xs text-rose-700/80 dark:text-rose-400/80">
                      Irreversibly remove your vendor profile and product portfolio.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  All active catalog items will be removed permanently. Unsettled wallet balances must be withdrawn before deletion.
                </p>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setIsDeleteOpen(true)}
                  className="rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white"
                >
                  Delete Vendor Account
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        <ConfirmDialog
          open={isDeactivateOpen}
          onOpenChange={setIsDeactivateOpen}
          title="Deactivate Vendor Store?"
          description="Your public storefront and listed products will be hidden from shoppers until reactivated."
          confirmText="Yes, Deactivate"
          variant="warning"
          isLoading={deactivateMutation.isPending}
          onConfirm={() => deactivateMutation.mutate()}
        />

        <ConfirmDialog
          open={isDeleteOpen}
          onOpenChange={setIsDeleteOpen}
          title="Permanently Delete Vendor Store?"
          description="Are you sure you want to permanently delete your vendor store and all products? This action cannot be reversed."
          confirmText="Permanently Delete"
          variant="destructive"
          isLoading={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate()}
        />
      </div>
  );
}
