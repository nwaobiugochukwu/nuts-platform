"use client";

import { publicApi } from "@/api/core/client";
import { authService } from "@/api/modules/auth";
import type { RegisterResponseDto, VerifyOtpResponseDto } from "@/api/dto/auth";
import { referralService } from "@/api/referral";
import { PublicOnlyLayout } from "@/component/auth/PublicOnlyLayout";
import { FormInput } from "@/component/form/FormInput";
import { FormTextarea } from "@/component/form/FormTextarea";
import { Button } from "@/component/ui/button";
import { SegmentedOtpInput } from "@/component/ui/SegmentedOtpInput";
import { zodResolver } from "@hookform/resolvers/zod";
import { AxiosError } from "axios";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Gift,
  Loader2,
  Mail,
  MapPin,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  XCircle,
} from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const registerSchema = z
  .object({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z.string().email("Invalid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#]).*$/,
        "Password must contain uppercase, lowercase, number and special character (@$!%*?&#)",
      ),
    confirmPassword: z.string().min(1, "Please confirm your password"),
    otpCode: z.string().length(6, "Verification code must be exactly 6 digits"),
    referralCode: z.string().optional(),
    shippingAddress: z.object({
      fullName: z.string().min(1, "Recipient full name is required"),
      phone: z
        .string()
        .regex(
          /^\+[1-9]\d{6,14}$/,
          "Phone number must include international country code (e.g. +2349064786655)",
        ),
      street: z.string().min(3, "Street address is required"),
      city: z.string().min(2, "City is required"),
      state: z.string().min(2, "State is required"),
      country: z.string().optional(),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type RegisterFormData = z.infer<typeof registerSchema>;

type Step = 1 | 2 | 3;

export default function RegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeStep, setActiveStep] = useState<Step>(1);
  const [resendTimer, setResendTimer] = useState(0);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);

  // Referral code live-validation state
  const [referralValid, setReferralValid] = useState<boolean | null>(null);
  const [referralError, setReferralError] = useState<string | null>(null);
  const [isValidatingCode, setIsValidatingCode] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const methods = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    mode: "onTouched",
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      confirmPassword: "",
      otpCode: "",
      referralCode: searchParams.get("ref") ?? "",
      shippingAddress: {
        fullName: "",
        phone: "",
        street: "",
        city: "",
        state: "",
        country: "Nigeria",
      },
    },
  });

  const {
    handleSubmit,
    setValue,
    setError,
    trigger,
    getValues,
    formState: { isSubmitting, errors },
  } = methods;

  const currentEmail = useWatch({ control: methods.control, name: "email" });
  const firstName = useWatch({ control: methods.control, name: "firstName" });
  const lastName = useWatch({ control: methods.control, name: "lastName" });
  const watchedReferralCode = useWatch({ control: methods.control, name: "referralCode" });
  const otpCode = useWatch({ control: methods.control, name: "otpCode" });

  const validateCode = useCallback(async (code: string, email: string) => {
    if (!code.trim()) {
      setReferralValid(null);
      setReferralError(null);
      return;
    }
    setIsValidatingCode(true);
    setReferralValid(null);
    setReferralError(null);
    try {
      await referralService.validate(code, email || undefined);
      setReferralValid(true);
      setReferralError(null);
    } catch {
      setReferralValid(false);
      setReferralError("Invalid or unrecognized referral code.");
    } finally {
      setIsValidatingCode(false);
    }
  }, []);

  // Debounced referral code validation
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!watchedReferralCode?.trim()) return;
    debounceRef.current = setTimeout(() => {
      validateCode(watchedReferralCode, currentEmail);
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [watchedReferralCode, currentEmail, validateCode]);

  // Sync shipping full name from Step 1
  useEffect(() => {
    if (firstName || lastName) {
      const combined = `${firstName || ""} ${lastName || ""}`.trim();
      const current = getValues("shippingAddress.fullName");
      if (!current || current === firstName || current === lastName) {
        setValue("shippingAddress.fullName", combined);
      }
    }
  }, [firstName, lastName, getValues, setValue]);

  // Resend OTP countdown
  useEffect(() => {
    if (resendTimer > 0) {
      const interval = setInterval(() => {
        setResendTimer((prev) => prev - 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [resendTimer]);

  // Keep browser tab title synchronized with OTP countdown
  useEffect(() => {
    if (activeStep === 2 && resendTimer > 0) {
      document.title = `(${resendTimer}s) Verify OTP — NUTS`;
    } else if (activeStep === 2) {
      document.title = "Verify OTP — NUTS";
    }
  }, [resendTimer, activeStep]);

  function extractRetryAfter(err: unknown): number | null {
    const axiosErr = err as AxiosError<{
      message?: string;
      retryAfter?: number;
      error?: { retryAfter?: number };
    }>;
    const data = axiosErr?.response?.data;
    if (typeof data?.retryAfter === "number") return data.retryAfter;
    if (typeof data?.error?.retryAfter === "number") return data.error.retryAfter;
    const header = axiosErr?.response?.headers?.["retry-after"];
    if (header && !isNaN(Number(header))) return Number(header);
    const msg = typeof data?.message === "string" ? data.message : "";
    const match = msg.match(/(\d+)\s*(?:second|sec|s)/i);
    if (match && match[1]) return parseInt(match[1], 10);
    return null;
  }

  // Request OTP from API
  async function requestOtpCode(emailToVerify?: string): Promise<boolean> {
    const target = emailToVerify || currentEmail || getValues("email");
    if (!target) {
      toast.error("Please enter your email address first.");
      return false;
    }
    setIsSendingOtp(true);
    try {
      await publicApi.post<VerifyOtpResponseDto>("/auth/otp/request", {
        email: target,
      });
      setResendTimer(60);
      toast.success(`Verification code dispatched to ${target}`);
      return true;
    } catch (err: unknown) {
      const retryAfter = extractRetryAfter(err);
      const msg =
        (err as AxiosError<{ message: string }>)?.response?.data?.message ??
        "Failed to send verification code. Please check your email or try again.";

      if (retryAfter && retryAfter > 0) {
        setResendTimer(retryAfter);
        toast.info(msg);
        return true;
      }

      toast.error(msg);
      return false;
    } finally {
      setIsSendingOtp(false);
    }
  }

  // Step 1 -> Step 2
  async function handleProceedToOtp() {
    const isStep1Valid = await trigger([
      "firstName",
      "lastName",
      "email",
      "password",
      "confirmPassword",
    ]);

    if (!isStep1Valid) {
      toast.error("Please fill all required account details before continuing.");
      return;
    }

    const sent = await requestOtpCode(currentEmail);
    if (sent) {
      setActiveStep(2);
    }
  }

  // Step 2 -> Step 3: Server-side OTP Validation before advancing to Shipping
  async function handleVerifyOtpAndProceed() {
    const isOtpValid = await trigger("otpCode");
    if (!isOtpValid) {
      toast.error("Please enter the complete 6-digit verification code.");
      return;
    }

    const emailToUse = currentEmail || getValues("email");
    if (!emailToUse) {
      toast.error("Missing email address. Please return to step 1.");
      setActiveStep(1);
      return;
    }

    setIsVerifyingOtp(true);
    try {
      await authService.verifyRegistrationOtp({
        email: emailToUse,
        otpCode: (otpCode || getValues("otpCode")).trim(),
      });
      toast.success("Verification code confirmed!");
      setActiveStep(3);
    } catch (err: unknown) {
      const axiosErr = err as AxiosError<{ message?: string; error?: { message?: string } }>;
      const msg =
        axiosErr?.response?.data?.message ??
        "Invalid or expired verification code. Please check and try again.";
      setError("otpCode", {
        type: "manual",
        message: msg,
      });
      toast.error(msg);
    } finally {
      setIsVerifyingOtp(false);
    }
  }

  // Step 3 -> Final Submit
  async function onSubmit(data: RegisterFormData) {
    try {
      await publicApi.post<RegisterResponseDto>("/auth/register", {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        password: data.password,
        otpCode: data.otpCode,
        referralCode: data.referralCode?.trim() || undefined,
        phone: data.shippingAddress.phone,
        shippingAddress: {
          fullName: data.shippingAddress.fullName,
          phone: data.shippingAddress.phone,
          street: data.shippingAddress.street,
          city: data.shippingAddress.city,
          state: data.shippingAddress.state,
          country: data.shippingAddress.country ?? "Nigeria",
        },
      });
      toast.success("Account created successfully! Please sign in.");
      router.push("/auth/login");
    } catch (err: unknown) {
      const msg =
        (err as AxiosError<{ message: string }>)?.response?.data?.message ??
        "Registration failed. Please check your details and verification code.";
      toast.error(msg);
      if (msg.toLowerCase().includes("otp") || msg.toLowerCase().includes("code")) {
        setActiveStep(2);
      }
    }
  }

  return (
    <PublicOnlyLayout>
      <div className="w-full space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-xs">
            <UserPlus className="h-6 w-6" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Create Your Account
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Sign up to get started with your customer account
          </p>
        </div>

        {/* Wizard Form Card */}
        <div className="rounded-3xl border border-border/80 bg-card p-5 sm:p-8 shadow-sm">
          <FormProvider {...methods}>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              {/* ─────────────────────────────────────────────────────────────
                  STEP 1: Account Credentials
              ───────────────────────────────────────────────────────────── */}
              {activeStep === 1 && (
                <div className="space-y-4 animate-in fade-in-50 duration-200">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
                    <FormInput
                      name="firstName"
                      label="First Name"
                      placeholder="Jane"
                      autoComplete="given-name"
                    />
                    <FormInput
                      name="lastName"
                      label="Last Name"
                      placeholder="Doe"
                      autoComplete="family-name"
                    />
                  </div>

                  <FormInput
                    name="email"
                    label="Email Address"
                    type="email"
                    placeholder="jane@example.com"
                    autoComplete="email"
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
                    <FormInput
                      name="password"
                      label="Password"
                      type="password"
                      placeholder="Min 8 characters"
                      autoComplete="new-password"
                    />
                    <FormInput
                      name="confirmPassword"
                      label="Confirm Password"
                      type="password"
                      placeholder="Repeat password"
                      autoComplete="new-password"
                    />
                  </div>

                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Must include at least 8 characters, uppercase, lowercase, number, and symbol (@$!%*?&#).
                  </p>

                  {/* Referral Code (Optional) */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span className="flex items-center gap-1.5 text-foreground">
                        <Gift className="h-3.5 w-3.5 text-amber-500" />
                        Referral Invite Code (Optional)
                      </span>
                      {isValidatingCode && (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" /> Checking...
                        </span>
                      )}
                      {!isValidatingCode && referralValid === true && (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Valid code
                        </span>
                      )}
                      {!isValidatingCode && referralValid === false && (
                        <span className="flex items-center gap-1 text-rose-500 font-semibold">
                          <XCircle className="h-3.5 w-3.5" /> Invalid code
                        </span>
                      )}
                    </div>
                    <FormInput
                      name="referralCode"
                      label=""
                      placeholder="e.g. NUTS-ABC123"
                      className="font-mono uppercase tracking-wider text-sm"
                    />
                    {referralError && (
                      <p className="text-xs text-rose-500">{referralError}</p>
                    )}
                  </div>

                  <Button
                    type="button"
                    onClick={handleProceedToOtp}
                    disabled={isSendingOtp}
                    className="w-full rounded-2xl h-12 text-sm font-bold shadow-sm mt-3 flex items-center justify-center gap-2"
                  >
                    {isSendingOtp ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Dispatching Verification Code...
                      </>
                    ) : (
                      <>
                        Continue to Verification
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              )}

              {/* ─────────────────────────────────────────────────────────────
                  STEP 2: OTP Verification
              ───────────────────────────────────────────────────────────── */}
              {activeStep === 2 && (
                <div className="space-y-6 text-center animate-in fade-in-50 duration-200 py-2">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Mail className="h-7 w-7" />
                  </div>

                  <div className="space-y-1">
                    <h2 className="text-lg sm:text-xl font-bold text-foreground">
                      Check Your Email
                    </h2>
                    <p className="text-xs sm:text-sm text-muted-foreground max-w-sm mx-auto">
                      We sent a 6-digit verification code to{" "}
                      <strong className="text-foreground">{currentEmail}</strong>
                    </p>
                  </div>

                  {/* 6-box segmented OTP display */}
                  <SegmentedOtpInput
                    id="otp-digit-input"
                    value={otpCode || ""}
                    onChange={(clean) => {
                      setValue("otpCode", clean, { shouldValidate: true });
                    }}
                    error={errors.otpCode?.message}
                    autoFocus
                  />

                  {/* Resend & Edit Email Controls */}
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-3 text-xs pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void requestOtpCode(currentEmail)}
                      disabled={isSendingOtp || resendTimer > 0}
                      className="rounded-xl h-9 text-xs font-semibold px-4 border-border/80"
                    >
                      {isSendingOtp ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
                          Dispatching code...
                        </>
                      ) : resendTimer > 0 ? (
                        <>
                          <Clock className="h-3.5 w-3.5 mr-1.5 text-amber-500" />
                          Resend code in {resendTimer}s
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                          Resend Code
                        </>
                      )}
                    </Button>

                    <button
                      type="button"
                      onClick={() => setActiveStep(1)}
                      className="text-muted-foreground hover:text-foreground font-medium underline underline-offset-4"
                    >
                      Wrong email? Edit credentials
                    </button>
                  </div>

                  <div className="flex gap-2.5 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setActiveStep(1)}
                      className="flex-1 rounded-2xl h-11 text-xs sm:text-sm font-semibold"
                    >
                      <ArrowLeft className="h-4 w-4 mr-1.5" />
                      Back
                    </Button>
                    <Button
                      type="button"
                      onClick={handleVerifyOtpAndProceed}
                      disabled={otpCode?.length !== 6 || isVerifyingOtp}
                      className="flex-1 rounded-2xl h-11 text-xs sm:text-sm font-bold shadow-sm"
                    >
                      {isVerifyingOtp ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin mr-1.5" />
                          Verifying Code...
                        </>
                      ) : (
                        <>
                          Continue to Shipping
                          <ArrowRight className="h-4 w-4 ml-1.5" />
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* ─────────────────────────────────────────────────────────────
                  STEP 3: Shipping & Delivery
              ───────────────────────────────────────────────────────────── */}
              {activeStep === 3 && (
                <div className="space-y-4 animate-in fade-in-50 duration-200">
                  <div className="flex items-center justify-between pb-2 border-b border-border/60">
                    <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                      <MapPin className="h-4 w-4 text-primary" />
                      Delivery Destination
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveStep(1)}
                      className="text-xs font-semibold text-primary hover:underline"
                    >
                      Edit Info
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
                    <FormInput
                      name="shippingAddress.fullName"
                      label="Recipient Full Name"
                      placeholder="Jane Doe"
                    />
                    <FormInput
                      name="shippingAddress.phone"
                      label="Phone Number"
                      type="tel"
                      placeholder="+234 801 234 5678"
                    />
                  </div>

                  <FormTextarea
                    name="shippingAddress.street"
                    label="Street Address"
                    placeholder="House / Apartment number, street name, landmark"
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
                    <FormInput
                      name="shippingAddress.city"
                      label="City / Town"
                      placeholder="Ikeja"
                    />
                    <FormInput
                      name="shippingAddress.state"
                      label="State"
                      placeholder="Lagos State"
                    />
                  </div>

                  <FormInput
                    name="shippingAddress.country"
                    label="Country"
                    placeholder="Nigeria"
                    disabled
                  />

                  <div className="flex gap-2.5 pt-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setActiveStep(2)}
                      className="w-1/3 rounded-2xl h-12 text-xs sm:text-sm font-semibold"
                    >
                      <ArrowLeft className="h-4 w-4 mr-1.5" />
                      Back
                    </Button>
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-2/3 rounded-2xl h-12 text-xs sm:text-sm font-bold shadow-sm"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Creating Account...
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="h-4 w-4 mr-1.5" />
                          Complete Registration
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </form>
          </FormProvider>
        </div>

        {/* Footer */}
        <p className="text-center text-xs sm:text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/auth/login"
            className="font-bold text-primary hover:underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </div>
    </PublicOnlyLayout>
  );
}
