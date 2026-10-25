"use client";

import { userService } from "@/api";
import { getApiErrorMessage } from "@/api/core/error";
import type { UserResponseDto } from "@/api/dto/user";
import { referralService } from "@/api/referral";
import { PageHeader } from "@/component/common/PageHeader";
import { FormInput } from "@/component/form/FormInput";
import { ConfirmDialog } from "@/component/modal/ConfirmDialog";
import { OtpPromptDialog } from "@/component/modal/OtpPromptDialog";
import { ThemeSelector } from "@/component/theme/ThemeSelector";
import { Button } from "@/component/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/component/ui/card";
import { queryKey } from "@/lib/query-key";
import { useAuthStore } from "@/zustand/auth";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import {
AlertTriangle,
Bell,
Check,
CheckCircle2,
Copy,
Gift,
Lock,
Palette,
Share2,
Shield,
Trash2,
User,
Wallet
} from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { useState } from "react";
import { FormProvider,useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { NotificationPreferencesContent } from "@/components/domain/notification/NotificationPreferencesView";

// --- Validation Schemas ---

const profileSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  phone: z
    .string()
    .regex(
      /^\+[1-9]\d{6,14}$/,
      "Phone number must include international country code (e.g. +2349064786655)",
    ),
  email: z.string().email("Valid email is required"),
});

type ProfileForm = z.infer<typeof profileSchema>;

const passwordSchema = z
  .object({
    currentPassword: z.string().min(6, "Current password is required"),
    newPassword: z.string().min(8, "New password must be at least 8 characters"),
    confirmPassword: z.string().min(8, "Confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "New passwords do not match",
    path: ["confirmPassword"],
  });

type PasswordForm = z.infer<typeof passwordSchema>;

type SettingsTab = "profile" | "appearance" | "notifications" | "referral" | "security" | "danger";

export default function AccountSettingPage() {
  const qc = useQueryClient();
  const setUser = useAuthStore((state) => state.setUser);
  const logout = useAuthStore((state) => state.logout);

  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Deactivate Account Dialog State
  const [isConfirmDeactivateOpen, setIsConfirmDeactivateOpen] = useState(false);
  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);
  const [isRequestingOtp, setIsRequestingOtp] = useState(false);

  // Permanent Delete Dialog State
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  // 1. Fetch current profile
  const { data: user, isLoading: userLoading } = useQuery({
    queryKey: queryKey.user.profile,
    queryFn: async () => {
      const res = await userService.me();
      return res.data;
    },
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 15,
  });

  // Referral stats — fetched only when the referral tab is active
  const { data: referralStats, isLoading: referralStatsLoading } = useQuery({
    queryKey: ["referral", "stats"],
    queryFn: async () => (await referralService.getStats()).data,
    enabled: activeTab === "referral",
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });

  // 2. Profile Form
  const profileForm = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    values: {
      firstName: user?.firstName ?? "",
      lastName: user?.lastName ?? "",
      phone: user?.phoneNumber ?? "",
      email: user?.email ?? "",
    },
    disabled: !user,
  });

  // 3. Password Form
  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  // Profile Mutation
  const saveProfile = useMutation({
    mutationFn: (body: ProfileForm) =>
      userService.updateProfile({
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone,
        email: body.email,
      }),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: queryKey.user.profile });
      const previous = qc.getQueryData<UserResponseDto>(queryKey.user.profile);
      qc.setQueryData<UserResponseDto>(queryKey.user.profile, (current) =>
        current
          ? {
              ...current,
              firstName: body.firstName,
              lastName: body.lastName,
              phoneNumber: body.phone,
              email: body.email,
            }
          : current
      );
      return { previous };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: queryKey.user.profile });
      if (res?.data) {
        setUser(res.data);
      }
      toast.success("Profile updated successfully");
    },
    onError: (err: unknown, _body, context) => {
      qc.setQueryData(queryKey.user.profile, context?.previous);
      toast.error(getApiErrorMessage(err, "Update failed"));
    },
  });

  // Password Mutation
  const changePassword = useMutation({
    mutationFn: (body: PasswordForm) =>
      userService.changePassword({
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
      }),
    onSuccess: () => {
      passwordForm.reset();
      toast.success("Password changed successfully");
    },
    onError: (err: unknown) => {
      toast.error(getApiErrorMessage(err, "Failed to change password"));
    },
  });

  // Deactivate Account Handlers
  const handleConfirmDeactivation = async () => {
    try {
      setIsRequestingOtp(true);
      await userService.requestDeactivateOtp();
      setIsConfirmDeactivateOpen(false);
      setIsDeactivateOpen(true);
      toast.success("A 6-digit verification code has been sent to your email.");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to send verification code."));
    } finally {
      setIsRequestingOtp(false);
    }
  };

  const deactivateMutation = useMutation({
    mutationFn: (otpCode: string) => userService.deactivate(otpCode),
    onSuccess: async (res) => {
      setIsDeactivateOpen(false);
      toast.success(
        res.data?.message || "Account deactivated. You can sign in within the grace period to reactivate."
      );
      await logout({ skipApi: true, redirectTo: "/auth/login" });
    },
    onError: (err: unknown) => {
      toast.error(getApiErrorMessage(err, "Account deactivation failed. Check your OTP code."));
    },
  });

  // Permanent Delete Mutation
  const deleteMutation = useMutation({
    mutationFn: () => userService.deleteAccount(),
    onSuccess: async () => {
      setIsDeleteOpen(false);
      toast.success("Your account has been permanently deleted.");
      await logout({ skipApi: true, redirectTo: "/auth/login" });
    },
    onError: (err: unknown) => {
      toast.error(getApiErrorMessage(err, "Failed to permanently delete account."));
    },
  });

  // Referral copy helpers — prefer live stats code, fallback to profile
  const referralCode = referralStats?.code ?? user?.referralCode ?? "NUTS-MEMBER";
  const referralLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/auth/register?ref=${referralCode}`
      : `https://nuts.com/auth/register?ref=${referralCode}`;

  const copyToClipboard = (text: string, type: "code" | "link") => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      if (type === "code") {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      } else {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      }
      toast.success(type === "code" ? "Referral code copied!" : "Referral invite link copied!");
    }
  };

  if (userLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="h-48 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-900" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        title="Settings & Preferences"
        description="Manage your identity, visual appearance, referral program, and security"
      />

      {/* Segmented Navigation Tabs */}
      <div className="mt-8 flex gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-4 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab("profile")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all ${
            activeTab === "profile"
              ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-xs"
              : "text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-900"
          }`}
        >
          <User className="h-4 w-4" />
          <span>Profile Information</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("appearance")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all ${
            activeTab === "appearance"
              ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-xs"
              : "text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-900"
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
              ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-xs"
              : "text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-900"
          }`}
        >
          <Bell className="h-4 w-4" />
          <span>Notification Preferences</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("referral")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all ${
            activeTab === "referral"
              ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-xs"
              : "text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-900"
          }`}
        >
          <Gift className="h-4 w-4" />
          <span>Referral Program</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("security")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all ${
            activeTab === "security"
              ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-xs"
              : "text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-900"
          }`}
        >
          <Shield className="h-4 w-4" />
          <span>Security & Password</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("danger")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all ${
            activeTab === "danger"
              ? "bg-rose-600 text-white shadow-xs"
              : "text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20"
          }`}
        >
          <AlertTriangle className="h-4 w-4" />
          <span>Account Lifecycle</span>
        </button>
      </div>

      {/* Tab 1: Profile Information */}
      {activeTab === "profile" && (
        <div className="mt-6 max-w-2xl">
          <Card className="rounded-2xl border-neutral-200/80 dark:border-neutral-800">
            <CardHeader>
              <CardTitle className="text-lg">Personal Details</CardTitle>
              <CardDescription>
                Update your contact details associated with your orders and identity.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FormProvider {...profileForm}>
                <form
                  onSubmit={profileForm.handleSubmit((values) => saveProfile.mutate(values))}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormInput name="firstName" label="First Name" placeholder="e.g. Hugo" />
                    <FormInput name="lastName" label="Last Name" placeholder="e.g. Doe" />
                  </div>
                  <FormInput name="email" label="Email Address" type="email" placeholder="name@domain.com" />
                  <FormInput name="phone" label="Primary Phone Number" placeholder="+2349064786655" />

                  <div className="pt-2">
                    <Button
                      type="submit"
                      disabled={saveProfile.isPending}
                      className="rounded-xl px-6 py-2.5 text-xs font-bold bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                    >
                      {saveProfile.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </form>
              </FormProvider>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tab 2: Appearance & Theme */}
      {activeTab === "appearance" && (
        <div className="mt-6 max-w-2xl">
          <Card className="rounded-2xl border-neutral-200/80 dark:border-neutral-800">
            <CardHeader>
              <CardTitle className="text-lg">Theme & Visual Experience</CardTitle>
              <CardDescription>
                Customize how NUTS appears on your device. Choose between clean porcelain white or sleek obsidian dark mode.
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
        <div className="mt-6 max-w-2xl">
          <NotificationPreferencesContent />
        </div>
      )}

      {/* Tab 3: Referral Program & Rewards */}
      {activeTab === "referral" && (
        <div className="mt-6 max-w-2xl space-y-6">
          <Card className="rounded-2xl border-neutral-200/80 dark:border-neutral-800 overflow-hidden">
            <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent p-6 sm:p-7 border-b border-amber-500/20">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-md">
                  <Gift className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-foreground">Your Referral Program</h3>
                  <p className="text-xs text-muted-foreground">
                    Invite friends to NUTS and earn wallet credits on their completed orders.
                  </p>
                </div>
              </div>
            </div>

            <CardContent className="p-6 sm:p-7 space-y-6">

              {/* Live Stats Bar */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 text-center">
                  <div className="text-xl font-bold text-foreground">
                    {referralStatsLoading ? "—" : (referralStats?.totalReferred ?? 0)}
                  </div>
                  <div className="text-xs text-muted-foreground font-medium mt-0.5">Total Referred</div>
                </div>
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-900/20 p-3 text-center">
                  <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                    {referralStatsLoading ? "—" : (referralStats?.rewardedCount ?? 0)}
                  </div>
                  <div className="text-xs text-muted-foreground font-medium mt-0.5">Rewarded</div>
                </div>
                <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-900/20 p-3 text-center">
                  <div className="text-xl font-bold text-amber-600 dark:text-amber-400">
                    {referralStatsLoading ? "—" : (referralStats?.pendingCount ?? 0)}
                  </div>
                  <div className="text-xs text-muted-foreground font-medium mt-0.5">Pending</div>
                </div>
              </div>

              {/* Code Box */}
              <div className="space-y-2">
                <span className="text-sm font-medium text-foreground block">Your Unique Referral Code</span>
                <div className="flex items-center gap-2">
                  <div className="flex-1 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-4 py-3 font-mono font-bold tracking-widest text-lg text-foreground select-all">
                    {referralCode}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => copyToClipboard(referralCode, "code")}
                    className="rounded-xl h-12 px-4 text-sm font-medium shrink-0"
                  >
                    {copiedCode ? (
                      <>
                        <Check className="h-4 w-4 mr-1.5 text-emerald-500" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 mr-1.5" />
                        <span>Copy Code</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Shareable Link Box */}
              <div className="space-y-2">
                <label htmlFor="direct-invite-link" className="text-xs font-semibold text-foreground">
                  Direct Invite Link
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="direct-invite-link"
                    name="referralLink"
                    type="text"
                    readOnly
                    value={referralLink}
                    className="flex-1 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 py-2 text-xs text-muted-foreground truncate"
                  />
                  <Button
                    type="button"
                    onClick={() => copyToClipboard(referralLink, "link")}
                    className="rounded-xl h-9 px-4 text-xs font-bold bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 shrink-0"
                  >
                    {copiedLink ? (
                      <>
                        <Check className="h-3.5 w-3.5 mr-1 text-emerald-400" />
                        <span>Link Copied</span>
                      </>
                    ) : (
                      <>
                        <Share2 className="h-3.5 w-3.5 mr-1" />
                        <span>Copy Link</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Benefits Checklist */}
              <div className="rounded-2xl bg-neutral-50 dark:bg-neutral-900/60 p-5 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  How Referral Rewards Work
                </p>
                <ul className="space-y-2 text-xs text-foreground">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                    <span>Your friends receive an exclusive discount on their first purchase when registering.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                    <span>You automatically earn referral credits deposited into your NUTS Wallet once their order is fulfilled.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                    <span>Spend your wallet credits toward any product or vendor drop across the platform.</span>
                  </li>
                </ul>

                <div className="pt-2">
                  <Button asChild variant="outline" size="sm" className="rounded-xl text-xs">
                    <Link href="/wallet" className="flex items-center gap-1.5">
                      <Wallet className="h-3.5 w-3.5" />
                      <span>View Wallet Rewards</span>
                    </Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tab 4: Security & Password */}
      {activeTab === "security" && (
        <div className="mt-6 max-w-2xl">
          <Card className="rounded-2xl border-neutral-200/80 dark:border-neutral-800">
            <CardHeader>
              <CardTitle className="text-lg">Change Password</CardTitle>
              <CardDescription>
                Ensure your account is protected with a secure and unique password.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FormProvider {...passwordForm}>
                <form
                  onSubmit={passwordForm.handleSubmit((values) => changePassword.mutate(values))}
                  className="space-y-4"
                >
                  <FormInput
                    name="currentPassword"
                    label="Current Password"
                    type="password"
                    placeholder="••••••••••••"
                  />
                  <FormInput
                    name="newPassword"
                    label="New Password"
                    type="password"
                    placeholder="Minimum 8 characters"
                  />
                  <FormInput
                    name="confirmPassword"
                    label="Confirm New Password"
                    type="password"
                    placeholder="Repeat new password"
                  />

                  <div className="pt-2">
                    <Button
                      type="submit"
                      disabled={changePassword.isPending}
                      className="rounded-xl px-6 py-2.5 text-xs font-bold bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                    >
                      {changePassword.isPending ? "Updating Password..." : "Update Password"}
                    </Button>
                  </div>
                </form>
              </FormProvider>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tab 5: Danger Zone & Lifecycle */}
      {activeTab === "danger" && (
        <div className="mt-6 max-w-2xl space-y-6">
          {/* Deactivation Card */}
          <Card className="rounded-2xl border-amber-200 dark:border-amber-950/40 bg-amber-50/30 dark:bg-amber-950/10">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
                  <Lock className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base text-amber-900 dark:text-amber-300">
                    Deactivate Account
                  </CardTitle>
                  <CardDescription className="text-xs text-amber-700/80 dark:text-amber-400/80">
                    Temporarily disable your profile. You have a 60-day grace period to sign back in before permanent deletion.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Deactivation logs out all active sessions and pauses all ongoing notifications. A 2FA verification code sent to your email will be required to confirm this operation.
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={isRequestingOtp}
                onClick={() => setIsConfirmDeactivateOpen(true)}
                className="rounded-xl border-amber-300 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-300 text-xs font-semibold"
              >
                Deactivate Account
              </Button>
            </CardContent>
          </Card>

          {/* Permanent Deletion Card */}
          <Card className="rounded-2xl border-rose-200 dark:border-rose-950/40 bg-rose-50/30 dark:bg-rose-950/10">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/10 text-rose-600">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base text-rose-900 dark:text-rose-300">
                    Permanently Delete Account
                  </CardTitle>
                  <CardDescription className="text-xs text-rose-700/80 dark:text-rose-400/80">
                    Irreversibly remove your account and all associated personal records.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                This action is immediate and non-recoverable. All pending carts and saved addresses will be purged immediately according to privacy regulations.
              </p>
              <Button
                type="button"
                variant="destructive"
                onClick={() => setIsDeleteOpen(true)}
                className="rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white"
              >
                Delete My Account Permanently
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 1: Confirmation Card Popup before sending OTP */}
      <ConfirmDialog
        open={isConfirmDeactivateOpen}
        onOpenChange={setIsConfirmDeactivateOpen}
        title="Are you sure you want to deactivate your account?"
        description="Deactivating your account will temporarily disable your profile and log you out of all active sessions. You will have a 60-day grace period to sign back in and reactivate before permanent deletion. If you proceed, a 6-digit verification code will be sent to your email."
        confirmText="Yes, Deactivate"
        cancelText="Cancel"
        variant="warning"
        isLoading={isRequestingOtp}
        onConfirm={handleConfirmDeactivation}
      />

      {/* Step 2: Otp Dialog for Deactivation with countdown timer */}
      <OtpPromptDialog
        open={isDeactivateOpen}
        onOpenChange={setIsDeactivateOpen}
        title="Confirm Account Deactivation"
        description="Enter the 6-digit security verification code sent to your email to deactivate your account."
        codeLabel="Verification Code"
        codeSubtitle="Check your inbox"
        confirmText="Confirm Deactivation"
        isLoading={deactivateMutation.isPending}
        initialCooldown={60}
        onRequestOtp={async () => {
          await userService.requestDeactivateOtp();
          toast.success("Verification code resent to your email.");
        }}
        onSubmit={({ otpCode }) => deactivateMutation.mutate(otpCode)}
      />

      {/* Confirm Dialog for Permanent Deletion */}
      <ConfirmDialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        title="Permanently Delete Account?"
        description="Are you absolutely sure you want to permanently delete your NUTS account? This action is irreversible."
        confirmText="Yes, Permanently Delete"
        variant="destructive"
        isLoading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />

    </div>
  );
}
