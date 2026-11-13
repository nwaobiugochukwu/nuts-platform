"use client";

import { PublicOnlyLayout } from "@/component/auth/PublicOnlyLayout";
import { FormInput } from "@/component/form/FormInput";
import { Button } from "@/component/ui/button";
import { safeInternalPath } from "@/lib/safe-internal-path";
import { useAuthStore } from "@/zustand/auth";
import { zodResolver } from "@hookform/resolvers/zod";
import { Store } from "lucide-react";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { parseGoogleAuthError } from "@/lib/google-auth-error";
import Link from "@/components/navigation/AppLink";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const vendorLoginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type VendorLoginFormData = z.infer<typeof vendorLoginSchema>;

function VendorLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = safeInternalPath(
    searchParams.get("redirect"),
    "/vendor/analytic",
  );
  const login = useAuthStore((s) => s.login);
  const googleAuthenticate = useAuthStore((s) => s.googleAuthenticate);

  const methods = useForm<VendorLoginFormData>({
    resolver: zodResolver(vendorLoginSchema),
    defaultValues: { email: "", password: "" },
  });

  const {
    handleSubmit,
    formState: { isSubmitting },
  } = methods;

  async function onSubmit(data: VendorLoginFormData) {
    try {
      await login({ email: data.email, password: data.password, role: "vendor" });
      toast.success("Welcome to your vendor dashboard!");
      router.push(redirectUrl);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Login failed. Please check your credentials.";
      toast.error(msg);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6 p-4 sm:p-6">
      <div className="text-center space-y-2">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-xs">
          <Store className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Vendor Sign In</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">Sign in to manage your storefront &amp; sales</p>
      </div>

      <div className="space-y-4">
        <GoogleSignInButton
          onSuccess={async (idToken) => {
            try {
              await googleAuthenticate(idToken, "vendor", "login");
              toast.success("Welcome to your vendor dashboard!");
              router.push(redirectUrl);
            } catch (err: unknown) {
              const parsed = parseGoogleAuthError(err);
              if (parsed.isGoogleAccountNotFound) {
                toast.info("No vendor account is associated with this Google account. Please sign up first.");
                const signupUrl = searchParams.get("redirect")
                  ? `/auth/vendor/register?redirect=${encodeURIComponent(redirectUrl)}`
                  : "/auth/vendor/register";
                router.replace(signupUrl);
                return;
              }
              toast.error(parsed.message);
            }
          }}
          onError={(msg) => toast.error(msg)}
        />
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border/60" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">or sign in with email</span>
          </div>
        </div>
      </div>

      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <FormInput
            name="email"
            label="Vendor Email Address"
            type="email"
            placeholder="vendor@example.com"
            autoComplete="email"
          />
          <FormInput
            name="password"
            label="Password"
            type="password"
            placeholder="Enter password"
            autoComplete="current-password"
          />
          <Button
            type="submit"
            className="w-full rounded-xl font-semibold shadow-xs"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Accessing Dashboard..." : "Sign In as Vendor"}
          </Button>
        </form>
      </FormProvider>

      <div className="flex items-center justify-between text-xs sm:text-sm pt-2">
        <Link href="/auth/vendor/register" className="font-semibold text-primary hover:underline">
          Become a Vendor
        </Link>
        <Link href="/auth/forgot-password" className="font-semibold text-primary hover:underline">
          Forgot password?
        </Link>
      </div>

      {/* Switch to Customer Login */}
      <div className="border-t border-border/50 pt-4 text-center">
        <p className="text-xs text-muted-foreground">
          Looking to shop?{" "}
          <Link href="/auth/login" className="font-semibold text-primary hover:underline">
            Customer Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function VendorLoginPage() {
  return (
    <PublicOnlyLayout>
      <Suspense
        fallback={
          <div className="mx-auto max-w-md p-8 text-center">
            <div className="h-10 w-32 mx-auto animate-pulse rounded bg-muted/60" />
          </div>
        }
      >
        <VendorLoginForm />
      </Suspense>
    </PublicOnlyLayout>
  );
}
