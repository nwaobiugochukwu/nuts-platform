"use client";

import { useNotificationPreferences } from "@/hooks/use-notification-preferences";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useAuthStore } from "@/zustand/auth";
import { Button } from "@/component/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/component/ui/dialog";
import {
  Bell,
  Check,
  CreditCard,
  Info,
  Mail,
  Package,
  Shield,
  Smartphone,
  Sparkles,
  Tag,
  Users,
} from "lucide-react";

interface SwitchToggleProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function SwitchToggle({ id, checked, onChange, disabled }: SwitchToggleProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary ${
        disabled
          ? "cursor-not-allowed opacity-50 bg-muted"
          : checked
          ? "bg-primary cursor-pointer"
          : "bg-muted cursor-pointer"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow-md transition duration-200 ease-in-out ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export function NotificationPreferencesContent() {
  const role = useAuthStore((s) => s.role);
  const isMerchant = role === "vendor" || role === "admin";
  const { preferences, isLoading, isUpdating, updatePreferences, fetchPreferences } =
    useNotificationPreferences();
  const {
    isSupported: isPushSupported,
    isSubscribed,
    permission: pushPermission,
    isLoading: isPushLoading,
    subscribe: subscribePush,
    unsubscribe: unsubscribePush,
    sendTestPush,
  } = usePushNotifications();

  if (isLoading && !preferences) {
    return (
      <div className="space-y-4 py-6">
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-2xl bg-muted" />
        <div className="h-48 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  const prefs = preferences || {
    emailEnabled: true,
    inAppEnabled: true,
    pushEnabled: true,
    orderUpdates: true,
    paymentAlerts: true,
    inventoryAlerts: true,
    socialUpdates: true,
    marketingPromos: false,
  };

  return (
    <div className="space-y-6 text-foreground">
      {/* 1. Master Delivery Channels */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Delivery Channels
        </h3>
        <div className="divide-y divide-border/60 rounded-2xl border border-border bg-card">
          {/* In-App Notifications */}
          <div className="flex items-center justify-between p-4 sm:p-5">
            <div className="flex items-start gap-3 sm:gap-3.5 pr-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary mt-0.5">
                <Bell className="h-4 w-4" />
              </div>
              <div className="space-y-0.5">
                <label
                  htmlFor="inapp-toggle"
                  className="text-xs sm:text-sm font-semibold cursor-pointer block"
                >
                  In-App Notification Bell
                </label>
                <p className="text-[11px] sm:text-xs text-muted-foreground">
                  Show badges, notification feeds, and live toast alerts inside the app.
                </p>
              </div>
            </div>
            <SwitchToggle
              id="inapp-toggle"
              checked={prefs.inAppEnabled}
              disabled={isUpdating}
              onChange={(val) => updatePreferences({ inAppEnabled: val })}
            />
          </div>

          {/* Email Notifications */}
          <div className="flex items-center justify-between p-4 sm:p-5">
            <div className="flex items-start gap-3 sm:gap-3.5 pr-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 mt-0.5">
                <Mail className="h-4 w-4" />
              </div>
              <div className="space-y-0.5">
                <label
                  htmlFor="email-toggle"
                  className="text-xs sm:text-sm font-semibold cursor-pointer block"
                >
                  Email Notifications
                </label>
                <p className="text-[11px] sm:text-xs text-muted-foreground">
                  Receive transactional receipts, shipping confirmations, and updates to your email.
                </p>
              </div>
            </div>
            <SwitchToggle
              id="email-toggle"
              checked={prefs.emailEnabled}
              disabled={isUpdating}
              onChange={(val) => updatePreferences({ emailEnabled: val })}
            />
          </div>

          {/* Desktop & Push Notifications */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 p-3.5 sm:p-5">
            <div className="flex items-start gap-3 sm:gap-3.5 pr-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 mt-0.5">
                <Smartphone className="h-4 w-4" />
              </div>
              <div className="space-y-0.5">
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <label
                    htmlFor="push-toggle"
                    className="text-xs sm:text-sm font-semibold cursor-pointer block"
                  >
                    Push Notifications
                  </label>
                  {isSubscribed && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                      <Check className="h-3 w-3" /> Active on Device
                    </span>
                  )}
                </div>
                <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
                  Receive real-time push alerts on your device for incoming orders, payments, and account activity.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
              {process.env.NODE_ENV === "development" &&
                process.env.NEXT_PUBLIC_APP_ENV !== "staging" &&
                process.env.NEXT_PUBLIC_APP_ENV !== "production" &&
                isSubscribed && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPushLoading}
                    onClick={() => sendTestPush()}
                    className="h-8 px-2.5 text-xs font-semibold rounded-lg border-primary/30 text-primary hover:bg-primary/10 cursor-pointer"
                  >
                    Send Test Alert
                  </Button>
                )}

              {!isPushSupported ? (
                <span className="text-[11px] text-muted-foreground font-medium">
                  Unsupported
                </span>
              ) : (
                <SwitchToggle
                  id="push-toggle"
                  checked={isSubscribed && pushPermission === "granted"}
                  disabled={isUpdating || isPushLoading}
                  onChange={async (checked) => {
                    if (checked) {
                      await subscribePush();
                    } else {
                      await unsubscribePush();
                    }
                    await fetchPreferences();
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {pushPermission === "denied" && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2.5 text-xs text-muted-foreground">
            <Info className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <p>
              Push notifications are blocked in your browser settings. To enable them, click the lock/settings icon in your browser address bar and set Notifications to &quot;Allow&quot;.
            </p>
          </div>
        )}

        {isPushSupported && prefs.pushEnabled && pushPermission === "granted" && !isSubscribed && (
          <div className="flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>This browser has permission, but its push subscription is inactive. Reconnect this device to receive alerts.</p>
            <Button type="button" size="sm" variant="outline" disabled={isPushLoading} onClick={async () => { await subscribePush(); await fetchPreferences(); }}>
              Reconnect device
            </Button>
          </div>
        )}
      </section>

      {/* 2. Functional Categories Matrix */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Notification Categories
        </h3>
        <div className="divide-y divide-border/60 rounded-2xl border border-border bg-card">
          {/* Order Updates */}
          <div className="flex items-center justify-between p-4 sm:p-5">
            <div className="flex items-start gap-3 sm:gap-3.5 pr-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 mt-0.5">
                <Package className="h-4 w-4" />
              </div>
              <div className="space-y-0.5">
                <label
                  htmlFor="orders-toggle"
                  className="text-xs sm:text-sm font-semibold cursor-pointer block"
                >
                  Order Updates & Tracking
                </label>
                <p className="text-[11px] sm:text-xs text-muted-foreground">
                  Order confirmations, fulfillment status, dispatched shipments, and delivery receipts.
                </p>
              </div>
            </div>
            <SwitchToggle
              id="orders-toggle"
              checked={prefs.orderUpdates}
              disabled={isUpdating}
              onChange={(val) => updatePreferences({ orderUpdates: val })}
            />
          </div>

          {role === "vendor" && (
            <div className="flex items-center justify-between p-4 sm:p-5">
              <div className="flex items-start gap-3 sm:gap-3.5 pr-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 mt-0.5">
                  <Users className="h-4 w-4" />
                </div>
                <div className="space-y-0.5">
                  <label
                    htmlFor="social-toggle"
                    className="text-xs sm:text-sm font-semibold cursor-pointer block"
                  >
                    Social Activity
                  </label>
                  <p className="text-[11px] sm:text-xs text-muted-foreground">
                    Get notified when someone follows your store.
                  </p>
                </div>
              </div>
              <SwitchToggle
                id="social-toggle"
                checked={prefs.socialUpdates}
                disabled={isUpdating}
                onChange={(val) => updatePreferences({ socialUpdates: val })}
              />
            </div>
          )}

          {/* Payment & Payout Alerts */}
          <div className="flex items-center justify-between p-4 sm:p-5">
            <div className="flex items-start gap-3 sm:gap-3.5 pr-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mt-0.5">
                <CreditCard className="h-4 w-4" />
              </div>
              <div className="space-y-0.5">
                <label
                  htmlFor="payments-toggle"
                  className="text-xs sm:text-sm font-semibold cursor-pointer block"
                >
                  {isMerchant ? "Payment & Payout Alerts" : "Payment & Receipt Alerts"}
                </label>
                <p className="text-[11px] sm:text-xs text-muted-foreground">
                  {isMerchant
                    ? "Payment success confirmations, invoice receipts, refund notices, and merchant payouts."
                    : "Payment success confirmations, checkout receipts, and refund notices."}
                </p>
              </div>
            </div>
            <SwitchToggle
              id="payments-toggle"
              checked={prefs.paymentAlerts}
              disabled={isUpdating}
              onChange={(val) => updatePreferences({ paymentAlerts: val })}
            />
          </div>

          {/* Low Stock & Inventory */}
          <div className="flex items-center justify-between p-4 sm:p-5">
            <div className="flex items-start gap-3 sm:gap-3.5 pr-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400 mt-0.5">
                <Tag className="h-4 w-4" />
              </div>
              <div className="space-y-0.5">
                <label
                  htmlFor="inventory-toggle"
                  className="text-xs sm:text-sm font-semibold cursor-pointer block"
                >
                  Inventory & Stock Alerts
                </label>
                <p className="text-[11px] sm:text-xs text-muted-foreground">
                  Alerts when saved items drop in price or come back in stock, plus seller stock warnings.
                </p>
              </div>
            </div>
            <SwitchToggle
              id="inventory-toggle"
              checked={prefs.inventoryAlerts}
              disabled={isUpdating}
              onChange={(val) => updatePreferences({ inventoryAlerts: val })}
            />
          </div>

          {/* Marketing & Promos */}
          <div className="flex items-center justify-between p-4 sm:p-5">
            <div className="flex items-start gap-3 sm:gap-3.5 pr-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 mt-0.5">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="space-y-0.5">
                <label
                  htmlFor="marketing-toggle"
                  className="text-xs sm:text-sm font-semibold cursor-pointer block"
                >
                  Promotions & Special Offers
                </label>
                <p className="text-[11px] sm:text-xs text-muted-foreground">
                  Discount flash drops, referral bonus reminders, and seasonal campaign perks.
                </p>
              </div>
            </div>
            <SwitchToggle
              id="marketing-toggle"
              checked={prefs.marketingPromos}
              disabled={isUpdating}
              onChange={(val) => updatePreferences({ marketingPromos: val })}
            />
          </div>

          {/* Security Alerts (Always On) */}
          <div className="flex items-center justify-between p-4 sm:p-5 bg-muted/20">
            <div className="flex items-start gap-3 sm:gap-3.5 pr-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 mt-0.5">
                <Shield className="h-4 w-4" />
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs sm:text-sm font-semibold block">
                    Security & Account Safeguards
                  </span>
                  <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                    Always On
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-muted-foreground">
                  Password changes, suspicious logins, and fraud protection alerts cannot be disabled.
                </p>
              </div>
            </div>
            <SwitchToggle
              checked={true}
              disabled={true}
              onChange={() => undefined}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

export function NotificationPreferencesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full max-w-2xl max-h-[85vh] sm:max-h-[90vh] overflow-y-auto rounded-2xl sm:rounded-3xl p-4 sm:p-6 sm:p-8">
        <DialogHeader className="space-y-1.5 pb-2 text-left">
          <DialogTitle className="text-lg sm:text-xl font-bold flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            <span>Notification Preferences</span>
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm text-muted-foreground">
            Configure which channels and event types reach your device and inbox.
          </DialogDescription>
        </DialogHeader>

        {open && <NotificationPreferencesContent />}
      </DialogContent>
    </Dialog>
  );
}
