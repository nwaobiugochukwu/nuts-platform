"use client";

import { authService } from "@/api/auth";
import { getApiErrorMessage } from "@/api/core/error";
import { PublicOnlyLayout } from "@/component/auth/PublicOnlyLayout";
import { FormInput } from "@/component/form/FormInput";
import { Button } from "@/component/ui/button";
import { zodResolver } from "@hookform/resolvers/zod";
import { AxiosError } from "axios";
import { ArrowLeft,KeyRound,Mail,RefreshCw } from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { useRouter } from "next/navigation";
import { useEffect,useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { SegmentedOtpInput } from "@/components/ui/SegmentedOtpInput";

// Schema for Step 1: Request OTP
const requestOtpSchema = z.object({
  email: z.string().email("Please provide a valid email address"),
});

// Schema for Step 2: Verify OTP & Set New Password
const resetPasswordSchema = z
  .object({
    email: z.string().email("Please provide a valid email address"),
    otpCode: z.string().min(6, "OTP code must be 6 digits").max(6, "OTP code must be 6 digits"),
    newPassword: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#]).*$/,
        "Password must contain uppercase, lowercase, number and special character (@$!%*?&#)"
      ),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type RequestOtpFormData = z.infer<typeof requestOtpSchema>;
type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<"request" | "verify">("request");
  const [targetEmail, setTargetEmail] = useState("");
  const [resendTimer, setResendTimer] = useState(0);
  const [isSendingOtp, setIsSendingOtp] = useState(false);

  // Form for Step 1 (Request OTP)
  const requestMethods = useForm<RequestOtpFormData>({
    resolver: zodResolver(requestOtpSchema),
    defaultValues: { email: "" },
  });

  // Form for Step 2 (Reset Password)
  const resetMethods = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      email: "",
      otpCode: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const otpCodeValue = useWatch({ control: resetMethods.control, name: "otpCode" }) || "";

  // Countdown timer for OTP resend
  useEffect(() => {
    if (resendTimer > 0) {
      const interval = setInterval(() => {
        setResendTimer((prev) => prev - 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [resendTimer]);

  // Step 1 Submit: Request Password Reset OTP
  async function onRequestOtp(data: RequestOtpFormData) {
    setIsSendingOtp(true);
    try {
      await authService.requestPasswordResetOtp({ email: data.email });
      setTargetEmail(data.email);
      resetMethods.setValue("email", data.email);
      setStep("verify");
      setResendTimer(60);
      toast.success("Password reset code sent to your email!");
    } catch (err: unknown) {
      const axiosErr = err as AxiosError<{
        message?: string;
        retryAfter?: number;
        error?: { retryAfter?: number };
      }>;
      const respData = axiosErr?.response?.data;
      const retryAfter =
        (typeof respData?.retryAfter === "number" && respData.retryAfter) ||
        (typeof respData?.error?.retryAfter === "number" && respData.error.retryAfter) ||
        null;
      const msg = getApiErrorMessage(err, "Failed to send reset code. Please try again.");

      if (retryAfter && retryAfter > 0) {
        setTargetEmail(data.email);
        resetMethods.setValue("email", data.email);
        setStep("verify");
        setResendTimer(retryAfter);
        toast.info(msg);
      } else {
        toast.error(msg);
      }
    } finally {
      setIsSendingOtp(false);
    }
  }

  // Resend OTP handler
  async function handleResendOtp() {
    if (resendTimer > 0 || !targetEmail || isSendingOtp) return;
    setIsSendingOtp(true);
    try {
      await authService.requestPasswordResetOtp({ email: targetEmail });
      setResendTimer(60);
      toast.success("New verification code sent!");
    } catch (err: unknown) {
      const axiosErr = err as AxiosError<{
        message?: string;
        retryAfter?: number;
        error?: { retryAfter?: number };
      }>;
      const respData = axiosErr?.response?.data;
      const retryAfter =
        (typeof respData?.retryAfter === "number" && respData.retryAfter) ||
        (typeof respData?.error?.retryAfter === "number" && respData.error.retryAfter) ||
        null;
      const msg = getApiErrorMessage(err, "Failed to resend code. Please try again.");

      if (retryAfter && retryAfter > 0) {
        setResendTimer(retryAfter);
        toast.info(msg);
      } else {
        toast.error(msg);
      }
    } finally {
      setIsSendingOtp(false);
    }
  }

  // Step 2 Submit: Reset Password
  async function onResetPassword(data: ResetPasswordFormData) {
    try {
      await authService.resetPassword({
        email: data.email,
        otpCode: data.otpCode,
        newPassword: data.newPassword,
      });
      toast.success("Password reset successfully! Please sign in with your new password.");
      router.push("/auth/login");
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, "Failed to reset password. Please check the code and try again."));
    }
  }

  return (
    <PublicOnlyLayout>
      <div className="mx-auto max-w-md space-y-6 p-6 sm:p-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-900 text-white shadow-xs dark:bg-white dark:text-neutral-950">
            <KeyRound className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-white">
            {step === "request" ? "Recover Your Account" : "Set New Password"}
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {step === "request"
              ? "Enter your account email and we will send a 6-digit verification code to reset your password."
              : `Enter the 6-digit code dispatched to ${targetEmail}`}
          </p>
        </div>

        {step === "request" ? (
          /* STEP 1: Enter Email & Send OTP */
          <FormProvider {...requestMethods}>
            <form onSubmit={requestMethods.handleSubmit(onRequestOtp)} className="space-y-4">
              <FormInput
                name="email"
                label="Registered Email Address"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
              />

              <Button
                type="submit"
                className="w-full rounded-2xl font-semibold bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 py-6 text-base shadow-xs"
                disabled={isSendingOtp}
              >
                {isSendingOtp ? "Dispatching Code..." : "Send Verification Code"}
              </Button>
            </form>
          </FormProvider>
        ) : (
          /* STEP 2: Enter OTP Code & Set New Password */
          <div className="space-y-5">
            {/* Email pill with change option */}
            <div className="flex items-center justify-between rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/60 px-4 py-2.5 text-xs">
              <div className="flex items-center gap-2 text-neutral-900 dark:text-white font-medium truncate">
                <Mail className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                <span className="truncate">{targetEmail}</span>
              </div>
              <button
                type="button"
                onClick={() => setStep("request")}
                className="text-indigo-600 dark:text-indigo-400 hover:underline font-semibold shrink-0 ml-2"
              >
                Change
              </button>
            </div>

            <FormProvider {...resetMethods}>
              <form onSubmit={resetMethods.handleSubmit(onResetPassword)} className="space-y-4">
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 text-center">
                    6-Digit Verification Code
                  </label>
                  <SegmentedOtpInput
                    value={otpCodeValue}
                    onChange={(val) => resetMethods.setValue("otpCode", val, { shouldValidate: true })}
                    error={resetMethods.formState.errors.otpCode?.message}
                    autoFocus
                  />
                  <div className="flex justify-center pt-1">
                    <button
                      type="button"
                      onClick={handleResendOtp}
                      disabled={resendTimer > 0 || isSendingOtp}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white disabled:text-neutral-400 dark:disabled:text-neutral-600 transition-colors"
                    >
                      <RefreshCw className={`h-3 w-3 ${isSendingOtp ? "animate-spin" : ""}`} />
                      {resendTimer > 0 ? `Resend code in ${resendTimer}s` : "Didn't receive code? Resend"}
                    </button>
                  </div>
                </div>

                <FormInput
                  name="newPassword"
                  label="New Password"
                  type="password"
                  placeholder="Min 8 characters (A-Z, a-z, 0-9, @$!)"
                  autoComplete="new-password"
                  required
                />

                <FormInput
                  name="confirmPassword"
                  label="Confirm New Password"
                  type="password"
                  placeholder="Repeat new password"
                  autoComplete="new-password"
                  required
                />

                <Button
                  type="submit"
                  className="w-full rounded-2xl font-semibold bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 py-6 text-base shadow-xs"
                  disabled={resetMethods.formState.isSubmitting}
                >
                  {resetMethods.formState.isSubmitting ? "Updating Password..." : "Reset Password"}
                </Button>
              </form>
            </FormProvider>
          </div>
        )}

        {/* Footer Link */}
        <div className="text-center pt-2">
          <Link
            href="/auth/login"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Sign In
          </Link>
        </div>
      </div>
    </PublicOnlyLayout>
  );
}
