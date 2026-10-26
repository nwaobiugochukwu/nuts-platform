"use client";

import { publicApi } from "@/api/core/client";
import type { RegisterResponseDto, VerifyOtpResponseDto } from "@/api/dto/auth";
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
  Clock,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  ShieldCheck,
  Store,
} from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const vendorStepOneSchema = z
  .object({
    storeName: z.string().min(2, "Store name must be at least 2 characters"),
    email: z.string().email("Invalid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#]).*$/,
        "Password must contain uppercase, lowercase, number and special character (@$!%*?&#)"
      ),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

const vendorStepTwoSchema = z.object({
  otpCode: z.string().length(6, "Verification code must be exactly 6 digits"),
});

const vendorStepThreeSchema = z.object({
  storeDescription: z
    .string()
    .min(10, "Please provide at least 10 characters describing your store"),
  businessPhone: z
    .string()
    .regex(
      /^\+[1-9]\d{6,14}$/,
      "Phone number must include international country code (e.g. +2348012345678)"
    ),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

export const fullVendorSchema = z.object({
  storeName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  confirmPassword: z.string(),
  otpCode: z.string().length(6),
  storeDescription: z.string().min(10),
  businessPhone: z.string(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

export type VendorFormData = z.infer<typeof fullVendorSchema>;

export default function VendorRegisterPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);
  const [resendTimer, setResendTimer] = useState(0);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isSubmittingForm, setIsSubmittingForm] = useState(false);
  const [registeredStoreName, setRegisteredStoreName] = useState("");

  const methods = useForm<VendorFormData>({
    resolver: zodResolver(
      currentStep === 1
        ? vendorStepOneSchema
        : currentStep === 2
        ? vendorStepTwoSchema
        : currentStep === 3
        ? vendorStepThreeSchema
        : z.object({})
    ),
    mode: "onBlur",
    defaultValues: {
      storeName: "",
      email: "",
      password: "",
      confirmPassword: "",
      otpCode: "",
      storeDescription: "",
      businessPhone: "",
      firstName: "",
      lastName: "",
    },
  });

  const {
    trigger,
    setValue,
    control,
    getValues,
    formState: { errors },
  } = methods;

  const currentEmail = useWatch({ control, name: "email" });
  const currentOtp = useWatch({ control, name: "otpCode" });

  useEffect(() => {
    if (resendTimer > 0) {
      const interval = setInterval(() => setResendTimer((prev) => prev - 1), 1000);
      return () => clearInterval(interval);
    }
  }, [resendTimer]);

  async function handleSendOtp(): Promise<boolean> {
    if (!currentEmail) return false;
    setIsSendingOtp(true);
    try {
      await publicApi.post<VerifyOtpResponseDto>("/vendors/auth/otp/request", {
        email: currentEmail,
      });
      setResendTimer(60);
      toast.success("Verification code sent to your email!");
      return true;
    } catch (err: unknown) {
      const axiosErr = err as AxiosError<{
        message?: string;
        retryAfter?: number;
        error?: { retryAfter?: number };
      }>;
      const data = axiosErr?.response?.data;
      const retryAfter =
        (typeof data?.retryAfter === "number" && data.retryAfter) ||
        (typeof data?.error?.retryAfter === "number" && data.error.retryAfter) ||
        null;
      const msg = data?.message ?? "Failed to send code. Please try again.";

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

  async function handleNextStepOne() {
    const isValid = await trigger([
      "storeName",
      "email",
      "password",
      "confirmPassword",
    ]);
    if (!isValid) return;

    const sent = await handleSendOtp();
    if (sent) {
      setCurrentStep(2);
    }
  }

  async function handleNextStepTwo() {
    const isValid = await trigger("otpCode");
    if (!isValid) return;
    setCurrentStep(3);
  }

  async function handleFinalSubmit() {
    const isValid = await trigger(["storeDescription", "businessPhone"]);
    if (!isValid) return;

    const values = getValues();
    setIsSubmittingForm(true);

    try {
      await publicApi.post<RegisterResponseDto>("/vendors/auth/register", {
        storeName: values.storeName,
        email: values.email,
        password: values.password,
        otpCode: values.otpCode,
        storeDescription: values.storeDescription,
        businessPhone: values.businessPhone,
        firstName: values.firstName || undefined,
        lastName: values.lastName || undefined,
      });

      setRegisteredStoreName(values.storeName);
      toast.success("Vendor registration application submitted!");
      setCurrentStep(4);
    } catch (err: unknown) {
      const msg =
        (err as AxiosError<{ message: string }>)?.response?.data?.message ??
        "Registration failed. Please check your details.";
      toast.error(msg);
    } finally {
      setIsSubmittingForm(false);
    }
  }

  return (
    <PublicOnlyLayout>
      <div className="w-full space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-xs transition-transform hover:scale-105">
            {currentStep === 4 ? (
              <Clock className="h-6 w-6 sm:h-7 sm:w-7 text-amber-500" />
            ) : currentStep === 2 ? (
              <ShieldCheck className="h-6 w-6 sm:h-7 sm:w-7 text-primary" />
            ) : (
              <Store className="h-6 w-6 sm:h-7 sm:w-7 text-primary" />
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
            {currentStep === 4
              ? "Application Submitted"
              : currentStep === 2
              ? "Verify Your Email"
              : currentStep === 3
              ? "Store Profile & Contact"
              : "Open Your Merchant Store"}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
            {currentStep === 4
              ? "Your application is under administrative review."
              : currentStep === 2
              ? "Enter the 6-digit verification code sent to your email to continue."
              : currentStep === 3
              ? "Provide your business contact details and brand description."
              : "Launch your digital storefront on NUTS and start selling to verified customers nationwide."}
          </p>
        </div>

        {/* Wizard Card */}
        <div className="rounded-2xl sm:rounded-3xl border border-border/80 bg-card p-5 sm:p-8 shadow-sm transition-all">
          <FormProvider {...methods}>
            <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
              {/* STEP 1: Store Credentials */}
              {currentStep === 1 && (
                <div className="space-y-4 animate-in fade-in-50 duration-200">
                  <FormInput
                    name="storeName"
                    label="Store / Brand Name"
                    placeholder="e.g. Lagos Artisan Leather"
                    required
                  />

                  <FormInput
                    name="email"
                    label="Merchant Email Address"
                    type="email"
                    placeholder="merchant@example.com"
                    autoComplete="email"
                    required
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
                    <FormInput
                      name="password"
                      label="Password"
                      type="password"
                      placeholder="Min. 8 characters"
                      autoComplete="new-password"
                      required
                    />
                    <FormInput
                      name="confirmPassword"
                      label="Confirm Password"
                      type="password"
                      placeholder="Repeat password"
                      autoComplete="new-password"
                      required
                    />
                  </div>

                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Must include at least 8 characters, uppercase, lowercase, number, and special character (@$!%*?&#).
                  </p>

                  <Button
                    type="button"
                    onClick={handleNextStepOne}
                    disabled={isSendingOtp}
                    className="w-full rounded-xl sm:rounded-2xl font-bold h-12 text-sm sm:text-base mt-2 shadow-xs transition-all hover:shadow-md"
                  >
                    {isSendingOtp ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Sending Security Code...
                      </>
                    ) : (
                      <>
                        Continue to Verification
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </>
                    )}
                  </Button>
                </div>
              )}

              {/* STEP 2: Email Security OTP */}
              {currentStep === 2 && (
                <div className="space-y-5 animate-in fade-in-50 duration-200">
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5 text-center space-y-1">
                    <p className="text-xs text-muted-foreground">We sent a 6-digit security code to</p>
                    <p className="text-sm font-bold text-foreground break-all">{currentEmail}</p>
                  </div>

                  <div className="space-y-3 py-1">
                    <SegmentedOtpInput
                      id="vendor-step-otp"
                      value={currentOtp || ""}
                      onChange={(clean) =>
                        setValue("otpCode", clean, { shouldValidate: true })
                      }
                      error={errors.otpCode?.message}
                    />

                    <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 px-1">
                      <span>Didn&apos;t receive the code?</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleSendOtp}
                        disabled={isSendingOtp || resendTimer > 0}
                        className="h-8 text-xs font-semibold text-primary hover:text-primary/90"
                      >
                        {isSendingOtp ? (
                          <RefreshCw className="h-3 w-3 animate-spin mr-1.5" />
                        ) : (
                          <Send className="h-3 w-3 mr-1.5" />
                        )}
                        {resendTimer > 0 ? `Resend in ${resendTimer}s` : "Resend Code"}
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-col-reverse sm:flex-row items-center gap-2.5 sm:gap-3 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setCurrentStep(1)}
                      className="w-full sm:w-auto sm:px-6 rounded-xl sm:rounded-2xl font-semibold h-11 sm:h-12 text-sm"
                    >
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Back
                    </Button>
                    <Button
                      type="button"
                      onClick={handleNextStepTwo}
                      className="w-full sm:flex-1 rounded-xl sm:rounded-2xl font-bold h-11 sm:h-12 text-sm sm:text-base shadow-xs"
                    >
                      Verify & Continue
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </div>
                </div>
              )}

              {/* STEP 3: Store Profile Details */}
              {currentStep === 3 && (
                <div className="space-y-4 animate-in fade-in-50 duration-200">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
                    <FormInput
                      name="firstName"
                      label="Contact First Name"
                      placeholder="e.g. Adebayo"
                      hint="Optional"
                    />
                    <FormInput
                      name="lastName"
                      label="Contact Last Name"
                      placeholder="e.g. Adeleke"
                      hint="Optional"
                    />
                  </div>

                  <FormInput
                    name="businessPhone"
                    label="Business / Support Phone"
                    placeholder="+2348012345678"
                    hint="Include country code"
                    required
                  />

                  <FormTextarea
                    name="storeDescription"
                    label="Store Description"
                    placeholder="Briefly describe what your store sells and your brand promise (min 10 characters)..."
                    rows={3}
                    required
                  />

                  <div className="flex flex-col-reverse sm:flex-row items-center gap-2.5 sm:gap-3 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setCurrentStep(2)}
                      disabled={isSubmittingForm}
                      className="w-full sm:w-auto sm:px-6 rounded-xl sm:rounded-2xl font-semibold h-11 sm:h-12 text-sm"
                    >
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Back
                    </Button>
                    <Button
                      type="button"
                      onClick={handleFinalSubmit}
                      disabled={isSubmittingForm}
                      className="w-full sm:flex-1 rounded-xl sm:rounded-2xl font-bold h-11 sm:h-12 text-sm sm:text-base shadow-xs"
                    >
                      {isSubmittingForm ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Submitting Application...
                        </>
                      ) : (
                        "Complete Registration"
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* STEP 4: Application Submitted / Pending Review */}
              {currentStep === 4 && (
                <div className="text-center space-y-6 py-2 animate-in fade-in-50 duration-300">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <Clock className="h-8 w-8" />
                  </div>

                  <div className="space-y-2">
                    <h2 className="text-xl sm:text-2xl font-bold text-foreground">
                      {registeredStoreName || "Your Store"} Under Review
                    </h2>
                    <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
                      Thank you for applying to sell on NUTS! All new merchant accounts are vetted by platform administrators to ensure buyer safety and marketplace quality.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-border/80 bg-muted/40 p-4 sm:p-5 text-left text-xs space-y-2.5 text-muted-foreground">
                    <p className="font-semibold text-foreground flex items-center gap-2">
                      <Mail className="h-4 w-4 text-primary" />
                      What happens next?
                    </p>
                    <ul className="space-y-1.5 pl-5 list-disc leading-relaxed">
                      <li>
                        A confirmation receipt has been sent to{" "}
                        <strong className="text-foreground">{currentEmail}</strong>.
                      </li>
                      <li>Administrative verification typically completes within <strong>1 business day</strong>.</li>
                      <li>You will receive an official approval email with merchant dashboard access once activated.</li>
                    </ul>
                  </div>

                  <div className="pt-2">
                    <Button
                      type="button"
                      onClick={() => router.push("/auth/vendor/login")}
                      className="w-full rounded-xl sm:rounded-2xl font-bold h-12 text-sm sm:text-base shadow-xs"
                    >
                      Proceed to Merchant Sign In
                    </Button>
                  </div>
                </div>
              )}
            </form>
          </FormProvider>
        </div>

        {/* Footer Navigation */}
        {currentStep !== 4 && (
          <p className="text-center text-xs sm:text-sm text-muted-foreground">
            Already have a merchant store?{" "}
            <Link
              href="/auth/vendor/login"
              className="font-semibold text-primary hover:underline ml-1"
            >
              Sign in
            </Link>
          </p>
        )}
      </div>
    </PublicOnlyLayout>
  );
}
