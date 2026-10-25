"use client";

import { publicApi } from "@/api/core/client";
import type {
RegisterResponseDto,
VerifyOtpResponseDto
} from "@/api/dto/auth";
import { PublicOnlyLayout } from "@/component/auth/PublicOnlyLayout";
import { FormInput } from "@/component/form/FormInput";
import { Button } from "@/component/ui/button";
import { SegmentedOtpInput } from "@/component/ui/SegmentedOtpInput";
import { zodResolver } from "@hookform/resolvers/zod";
import { AxiosError } from "axios";
import { RefreshCw,Send,Store } from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { useRouter } from "next/navigation";
import { useEffect,useState } from "react";
import { FormProvider,useForm,useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const vendorRegisterSchema = z.object({
  storeName: z.string().min(2, "Store name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#]).*$/,
      "Password must contain uppercase, lowercase, number and special character (@$!%*?&#)"
    ),
  otpCode: z.string().min(6, "OTP must be 6 digits").max(6, "OTP must be 6 digits"),
});

type VendorRegisterFormData = z.infer<typeof vendorRegisterSchema>;

export default function VendorRegisterPage() {
  const router = useRouter();
  const [resendTimer, setResendTimer] = useState(0);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  const methods = useForm<VendorRegisterFormData>({
    resolver: zodResolver(vendorRegisterSchema),
    defaultValues: { storeName: "", email: "", password: "", otpCode: "" },
  });

  const {
    handleSubmit,
    trigger,
    setValue,
    formState: { isSubmitting, errors },
  } = methods;

  const currentEmail = useWatch({ control: methods.control, name: "email" });
  const currentOtp = useWatch({ control: methods.control, name: "otpCode" });

  useEffect(() => {
    if (resendTimer > 0) {
      const interval = setInterval(() => {
        setResendTimer((prev) => prev - 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [resendTimer]);

  async function handleSendOtp() {
    const isEmailValid = await trigger("email");
    if (!isEmailValid || !currentEmail) {
      toast.error("Please enter a valid vendor email first.");
      return;
    }

    setIsSendingOtp(true);
    try {
      await publicApi.post<VerifyOtpResponseDto>("/vendors/auth/otp/request", {
        email: currentEmail,
      });
      setOtpSent(true);
      setResendTimer(60);
      toast.success("Verification code sent to your vendor email!");
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
      const msg =
        data?.message ?? "Failed to send verification code. Please try again.";

      if (retryAfter && retryAfter > 0) {
        setResendTimer(retryAfter);
        setOtpSent(true);
        toast.info(msg);
      } else {
        toast.error(msg);
      }
    } finally {
      setIsSendingOtp(false);
    }
  }

  async function onSubmit(data: VendorRegisterFormData) {
    try {
      await publicApi.post<RegisterResponseDto>("/vendors/auth/register", {
        storeName: data.storeName,
        email: data.email,
        password: data.password,
        otpCode: data.otpCode,
      });
      toast.success("Vendor store created! Please sign in.");
      router.push("/auth/vendor/login");
    } catch (err: unknown) {
      const msg =
        (err as AxiosError<{ message: string }>)?.response?.data?.message ?? "Registration failed. Please verify your details.";
      toast.error(msg);
    }
  }

  return (
    <PublicOnlyLayout>
      <div className="mx-auto max-w-md space-y-6 p-6 sm:p-8">
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-xs">
            <Store className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Become a Vendor
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Launch your digital or physical store and reach thousands of buyers across Nigeria
          </p>
        </div>

        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <FormInput
              name="storeName"
              label="Store / Brand Name"
              placeholder="e.g. Lagos Artisan Store"
            />

            <div className="space-y-1.5">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <FormInput
                    name="email"
                    label="Vendor Email Address"
                    type="email"
                    placeholder="vendor@example.com"
                    autoComplete="email"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSendOtp}
                  disabled={isSendingOtp || resendTimer > 0}
                  className="rounded-xl font-semibold shrink-0 text-xs h-10 px-3.5"
                >
                  {isSendingOtp ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Send className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  {resendTimer > 0 ? `${resendTimer}s` : otpSent ? "Resend" : "Send OTP"}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="vendor-otp-input"
                className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 block uppercase tracking-wider"
              >
                6-Digit Verification Code
              </label>
              <SegmentedOtpInput
                id="vendor-otp-input"
                value={currentOtp || ""}
                onChange={(clean) => setValue("otpCode", clean, { shouldValidate: true })}
                error={errors.otpCode?.message}
                disabled={isSubmitting}
              />
              {otpSent && (
                <p className="text-xs text-emerald-600 font-medium text-center">
                  ✓ Verification code sent to {currentEmail}
                </p>
              )}
            </div>

            <FormInput
              name="password"
              label="Password"
              type="password"
              placeholder="Min 8 characters (A-Z, a-z, 0-9, @$!)"
              autoComplete="new-password"
            />

            <Button
              type="submit"
              className="w-full rounded-xl font-semibold shadow-xs mt-2"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Creating Vendor Store..." : "Register as Vendor"}
            </Button>
          </form>
        </FormProvider>

        <p className="text-center text-xs sm:text-sm text-muted-foreground">
          Already have a store?{" "}
          <Link href="/auth/vendor/login" className="font-semibold text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </PublicOnlyLayout>
  );
}
