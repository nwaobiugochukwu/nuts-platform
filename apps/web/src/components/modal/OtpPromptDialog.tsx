"use client";

import { Button } from "@/component/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/component/ui/dialog";
import { SegmentedOtpInput } from "@/component/ui/SegmentedOtpInput";
import { Loader2, Send, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface OtpPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  requireDuration?: boolean;
  durationLabel?: string;
  durationOptions?: { label: string; value: string }[];
  defaultDuration?: string;
  codeLabel?: string;
  codeSubtitle?: string;
  confirmText?: string;
  isLoading?: boolean;
  initialCooldown?: number;
  onRequestOtp?: () => Promise<void> | void;
  onSubmit: (data: { otpCode: string; reason?: string; duration?: string }) => void;
}

const DEFAULT_DURATIONS = [
  { label: "24 Hours (1 Day)", value: "24h" },
  { label: "3 Days", value: "3d" },
  { label: "7 Days (1 Week)", value: "7d" },
  { label: "14 Days (2 Weeks)", value: "14d" },
  { label: "30 Days (1 Month)", value: "30d" },
  { label: "Indefinite (Manual restore)", value: "indefinite" },
];

export function OtpPromptDialog({
  open,
  onOpenChange,
  title,
  description,
  requireReason = false,
  reasonLabel = "Reason for action",
  reasonPlaceholder = "Please provide an administrative reason...",
  requireDuration = false,
  durationLabel = "Suspension Duration",
  durationOptions = DEFAULT_DURATIONS,
  defaultDuration = "7d",
  codeLabel = "Security OTP Code",
  codeSubtitle = "Verification Code",
  confirmText = "Authorize Action",
  isLoading = false,
  initialCooldown = 0,
  onRequestOtp,
  onSubmit,
}: OtpPromptDialogProps) {
  const [otpCode, setOtpCode] = useState("");
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState(defaultDuration);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(initialCooldown);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [hasSentOtp, setHasSentOtp] = useState(initialCooldown > 0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open && initialCooldown > 0) {
      setCooldown(initialCooldown);
      setHasSentOtp(true);
    }
  }

  useEffect(() => {
    if (cooldown > 0) {
      timerRef.current = setTimeout(() => {
        setCooldown((c) => c - 1);
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [cooldown]);

  const handleRequestOtp = async () => {
    if (!onRequestOtp || isSendingOtp || cooldown > 0) return;
    try {
      setIsSendingOtp(true);
      setError(null);
      await onRequestOtp();
      setHasSentOtp(true);
      setCooldown(60);
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Failed to send verification code";
      setError(msg);
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim()) {
      setError("Security verification code is required");
      return;
    }
    if (requireReason && !reason.trim()) {
      setError("Administrative reason is required");
      return;
    }
    setError(null);
    onSubmit({
      otpCode: otpCode.trim(),
      reason: reason.trim(),
      duration: requireDuration ? duration : undefined,
    });
  };

  const handleOpenChange = (v: boolean) => {
    if (!isLoading) {
      if (!v) {
        setOtpCode("");
        setReason("");
        setDuration(defaultDuration);
        setError(null);
        setCooldown(0);
        setIsSendingOtp(false);
        setHasSentOtp(false);
        if (timerRef.current) clearTimeout(timerRef.current);
      }
      onOpenChange(v);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md rounded-2xl p-6 sm:p-7">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div className="flex-1 space-y-1">
              <DialogHeader className="p-0 text-left">
                <DialogTitle className="text-lg font-semibold text-neutral-900 dark:text-white">
                  {title}
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
                {description}
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            {requireDuration && (
              <div className="space-y-1.5">
                <label
                  htmlFor="otp-prompt-duration"
                  className="text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  {durationLabel}
                </label>
                <select
                  id="otp-prompt-duration"
                  name="duration"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
                >
                  {durationOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {requireReason && (
              <div className="space-y-1.5">
                <label
                  htmlFor="otp-prompt-reason"
                  className="text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  {reasonLabel}
                </label>
                <textarea
                  id="otp-prompt-reason"
                  name="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={reasonPlaceholder}
                  rows={2}
                  required
                  className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 py-2 text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
                />
              </div>
            )}

            <div className="space-y-3 pt-1">
              <label
                htmlFor="otp-prompt-code"
                className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 flex items-center justify-between uppercase tracking-wider"
              >
                <span>{codeLabel}</span>
                <span className="text-xs normal-case text-muted-foreground font-normal">{codeSubtitle}</span>
              </label>

              <SegmentedOtpInput
                id="otp-prompt-code"
                value={otpCode}
                onChange={(val) => {
                  setOtpCode(val);
                  if (error) setError(null);
                }}
                disabled={isLoading}
                autoFocus
                error={error || undefined}
              />

              {onRequestOtp && (
                <div className="flex items-center justify-center pt-1">
                  <button
                    type="button"
                    disabled={isSendingOtp || cooldown > 0 || isLoading}
                    onClick={handleRequestOtp}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline disabled:text-muted-foreground disabled:no-underline disabled:cursor-not-allowed transition-colors"
                  >
                    {isSendingOtp ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Sending code...</span>
                      </>
                    ) : cooldown > 0 ? (
                      <span>Resend code in {cooldown}s</span>
                    ) : (
                      <>
                        <Send className="h-3.5 w-3.5" />
                        <span>{hasSentOtp ? "Resend Verification Code" : "Send Verification Code"}</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="mt-6 flex flex-row items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isLoading}
              onClick={() => handleOpenChange(false)}
              className="rounded-xl text-sm h-9 px-4 font-medium"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isLoading || otpCode.trim().length !== 6}
              className="rounded-xl text-sm h-9 px-4 font-medium bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 shadow-xs disabled:opacity-50"
            >
              {isLoading ? "Verifying..." : confirmText}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
