"use client";

import { PublicOnlyLayout } from "@/component/auth/PublicOnlyLayout";
import { FormInput } from "@/component/form/FormInput";
import { Button } from "@/component/ui/button";
import { useAuthStore } from "@/zustand/auth";
import { zodResolver } from "@hookform/resolvers/zod";
import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { Suspense } from "react";
import { FormProvider,useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const adminLoginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type AdminLoginFormData = z.infer<typeof adminLoginSchema>;

function AdminLoginForm() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);

  const methods = useForm<AdminLoginFormData>({
    resolver: zodResolver(adminLoginSchema),
    defaultValues: { email: "", password: "" },
  });

  const { handleSubmit, formState: { isSubmitting } } = methods;

  async function onSubmit(data: AdminLoginFormData) {
    try {
      await login({ email: data.email, password: data.password, role: "admin" });
      toast.success("Welcome back, Administrator!");
      router.push("/admin");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Login failed. Please check your credentials.";
      toast.error(msg);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-xs">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Admin Sign In</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">Sign in to access the admin dashboard</p>
      </div>

      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <FormInput name="email" label="Admin Email" type="email" placeholder="admin@example.com" autoComplete="email" />
          <FormInput name="password" label="Password" type="password" placeholder="Enter password" autoComplete="current-password" />
          <Button
            type="submit"
            className="w-full rounded-xl font-semibold shadow-xs"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Signing in..." : "Sign In"}
          </Button>
        </form>
      </FormProvider>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <PublicOnlyLayout>
      <Suspense
        fallback={
          <div className="mx-auto max-w-md p-8 text-center">
            <div className="h-10 w-32 mx-auto animate-pulse rounded bg-muted/60" />
          </div>
        }
      >
        <AdminLoginForm />
      </Suspense>
    </PublicOnlyLayout>
  );
}