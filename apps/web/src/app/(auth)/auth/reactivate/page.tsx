"use client";

import { userService } from "@/api";
import { getApiErrorMessage } from "@/api/core/error";
import { PublicOnlyLayout } from "@/component/auth/PublicOnlyLayout";
import { FormInput } from "@/component/form/FormInput";
import { Button } from "@/component/ui/button";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const reactivateSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

type ReactivateForm = z.infer<typeof reactivateSchema>;

function ReactivateFormPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const form = useForm<ReactivateForm>({
    resolver: zodResolver(reactivateSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values: ReactivateForm) => {
    setIsSubmitting(true);
    try {
      await userService.reactivate(values);
      toast.success("Your account is active again. Sign in to continue.");
      router.replace("/auth/login");
    } catch (error) {
      toast.error(
        getApiErrorMessage(
          error,
          "Unable to reactivate this account. Check your credentials and the 60-day grace period.",
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-6 p-4 sm:p-6">
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">
          Reactivate your account
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Restore a deactivated account within its 60-day grace period.
        </p>
      </div>

      <FormProvider {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormInput
            name="email"
            label="Email address"
            type="email"
            autoComplete="email"
          />
          <FormInput
            name="password"
            label="Password"
            type="password"
            autoComplete="current-password"
          />
          <Button type="submit" className="w-full rounded-xl" disabled={isSubmitting}>
            {isSubmitting ? "Reactivating..." : "Reactivate account"}
          </Button>
        </form>
      </FormProvider>

      <div className="text-center">
        <Link
          href="/auth/login"
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>
      </div>
    </div>
  );
}

export default function ReactivateAccountPage() {
  return (
    <PublicOnlyLayout>
      <ReactivateFormPage />
    </PublicOnlyLayout>
  );
}
