"use client";

import { userService } from "@/api";
import { PublicOnlyLayout } from "@/component/auth/PublicOnlyLayout";
import { FormInput } from "@/component/form/FormInput";
import { Button } from "@/component/ui/button";
import { safeInternalPath } from "@/lib/safe-internal-path";
import { useAuthStore } from "@/zustand/auth";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, LogIn, ShieldAlert } from "lucide-react";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { parseGoogleAuthError } from "@/lib/google-auth-error";
import Link from "@/components/navigation/AppLink";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

interface SuspendedAccountInfo {
  email: string;
  reason: string;
  suspendedUntil: string | null;
  message: string;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = safeInternalPath(searchParams.get("redirect"), "/");
  const login = useAuthStore((s) => s.login);
  const googleAuthenticate = useAuthStore((s) => s.googleAuthenticate);

  const [deactivatedCredentials, setDeactivatedCredentials] = useState<LoginFormData | null>(null);
  const [suspendedInfo, setSuspendedInfo] = useState<SuspendedAccountInfo | null>(null);
  const [isReactivating, setIsReactivating] = useState(false);

  const methods = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const {
    handleSubmit,
    formState: { isSubmitting },
  } = methods;

  async function onSubmit(data: LoginFormData) {
    try {
      await login({ email: data.email, password: data.password, role: "user" });
      toast.success("Welcome back!");
      router.push(redirectUrl);
    } catch (err: unknown) {
      const res = (
        err as {
          response?: {
            data?: {
              message?: string;
              code?: string;
              error?: { code?: string; reason?: string; suspendedUntil?: string };
              reason?: string;
              suspendedUntil?: string;
            };
          };
        }
      )?.response?.data;

      const msg = res?.message ?? "Invalid email or password. Please try again.";

      if (msg === "ACCOUNT_DEACTIVATED") {
        setDeactivatedCredentials(data);
        setSuspendedInfo(null);
        return;
      }

      const isSuspended =
        res?.error?.code === "ACCOUNT_SUSPENDED" ||
        res?.code === "ACCOUNT_SUSPENDED" ||
        (typeof msg === "string" && msg.toLowerCase().includes("suspended"));

      if (isSuspended) {
        setSuspendedInfo({
          email: data.email,
          reason:
            res?.error?.reason ||
            res?.reason ||
            "Administrative review or policy violation.",
          suspendedUntil:
            res?.error?.suspendedUntil || res?.suspendedUntil || null,
          message:
            typeof msg === "string"
              ? msg
              : "Your account has been suspended by an administrator.",
        });
        setDeactivatedCredentials(null);
        return;
      }

      toast.error(typeof msg === "string" ? msg : "Authentication failed");
    }
  }

  async function handleReactivate() {
    if (!deactivatedCredentials) return;
    setIsReactivating(true);
    try {
      await userService.reactivate(deactivatedCredentials);
      toast.success("Account successfully reactivated!");
      await login({
        email: deactivatedCredentials.email,
        password: deactivatedCredentials.password,
        role: "user",
      });
      router.push(redirectUrl);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Unable to reactivate account. Please try again or contact support.";
      toast.error(msg);
    } finally {
      setIsReactivating(false);
    }
  }

  return (
    <div className="w-full max-w-md mx-auto space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-xs">
          <LogIn className="h-6 w-6" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Welcome Back</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">Sign in to your customer account</p>
      </div>

      <div className="rounded-3xl border border-border/80 bg-card p-5 sm:p-8 shadow-sm space-y-6">
        {suspendedInfo ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5 space-y-4 animate-in fade-in-0 duration-300">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/20 text-rose-600 dark:text-rose-400">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div className="flex-1 space-y-1">
                <h3 className="text-sm font-bold text-foreground">
                  Account Suspended
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Access for <strong className="text-foreground">{suspendedInfo.email}</strong> is temporarily suspended by platform administration.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-rose-500/20 bg-background/50 p-3.5 space-y-2 text-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <span className="text-muted-foreground font-medium">Suspension Reason:</span>
                <span className="font-semibold text-foreground text-right">{suspendedInfo.reason}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <span className="text-muted-foreground font-medium">Duration:</span>
                <span className="font-semibold text-rose-600 dark:text-rose-400 text-right">
                  {suspendedInfo.suspendedUntil
                    ? `Suspended until ${new Date(suspendedInfo.suspendedUntil).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}`
                    : "Indefinite (Subject to manual review)"}
                </span>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              If your suspension has an expiration date, your account will be restored automatically when the period concludes. For appeals, please contact support.
            </p>

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className="w-full text-xs font-semibold rounded-xl h-9"
                onClick={() => setSuspendedInfo(null)}
              >
                Dismiss & Switch Account
              </Button>
              <Button
                type="button"
                asChild
                className="w-full text-xs font-semibold rounded-xl h-9 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <a href="mailto:support@nutscommerce.com?subject=Account%20Suspension%20Inquiry">
                  Contact Support
                </a>
              </Button>
            </div>
          </div>
        ) : deactivatedCredentials ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 space-y-4 animate-in fade-in-0 duration-300">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">
                  Account Previously Deactivated
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Your credentials are valid, but your account (<strong className="text-foreground">{deactivatedCredentials.email}</strong>) is currently deactivated.
                </p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Clicking reactivate will restore your full account history, saved orders, and wishlist immediately.
            </p>

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <Button
                type="button"
                onClick={handleReactivate}
                disabled={isReactivating}
                className="w-full sm:flex-1 rounded-2xl h-11 font-semibold shadow-xs"
              >
                {isReactivating ? "Reactivating..." : "Reactivate & Sign In"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isReactivating}
                onClick={() => setDeactivatedCredentials(null)}
                className="rounded-2xl h-11 text-xs font-semibold"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <GoogleSignInButton
              onSuccess={async (idToken) => {
                try {
                  await googleAuthenticate(idToken, "user", "login");
                  toast.success("Welcome back!");
                  router.push(redirectUrl);
                } catch (err: unknown) {
                  const parsed = parseGoogleAuthError(err);
                  if (parsed.isGoogleAccountNotFound) {
                    toast.info("No customer account is associated with this Google account. Please sign up first.");
                    const signupUrl = searchParams.get("redirect")
                      ? `/auth/register?redirect=${encodeURIComponent(redirectUrl)}`
                      : "/auth/register";
                    router.replace(signupUrl);
                    return;
                  }
                  if (parsed.isSuspended) {
                    setSuspendedInfo({
                      email: "Your Google Account",
                      reason:
                        parsed.suspensionInfo?.reason ||
                        "Administrative review or policy violation.",
                      suspendedUntil:
                        parsed.suspensionInfo?.suspendedUntil || null,
                      message: parsed.message,
                    });
                    setDeactivatedCredentials(null);
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

            <FormProvider {...methods}>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <FormInput
                  name="email"
                  label="Email Address"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                />
                <FormInput
                  name="password"
                  label="Password"
                  type="password"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                />

                <Button
                  type="submit"
                  className="w-full rounded-2xl h-12 text-sm font-bold shadow-sm"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Signing in..." : "Sign In"}
                </Button>
              </form>
            </FormProvider>
          </div>
        )}

        <div className="flex items-center justify-between text-xs sm:text-sm pt-2">
          <Link href="/auth/forgot-password" className="font-semibold text-primary hover:underline underline-offset-4">
            Forgot password?
          </Link>
          <Link href="/auth/register" className="font-semibold text-primary hover:underline underline-offset-4">
            Create account
          </Link>
        </div>

        {/* Switch to Vendor Login */}
        <div className="border-t border-border/60 pt-4 text-center">
          <p className="text-xs text-muted-foreground">
            Are you a merchant?{" "}
            <Link href="/auth/vendor/login" className="font-semibold text-primary hover:underline underline-offset-4">
              Vendor Sign In
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <PublicOnlyLayout>
      <Suspense
        fallback={
          <div className="mx-auto max-w-md p-8 text-center">
            <div className="h-10 w-32 mx-auto animate-pulse rounded bg-muted/60" />
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </PublicOnlyLayout>
  );
}
