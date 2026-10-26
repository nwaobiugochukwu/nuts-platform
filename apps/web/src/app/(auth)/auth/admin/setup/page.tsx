"use client";

import { publicApi } from "@/api/core/client";
import type { AuthResponseDto } from "@/api/dto/auth";
import { PublicOnlyLayout } from "@/component/auth/PublicOnlyLayout";
import { FormInput } from "@/component/form/FormInput";
import { Button } from "@/component/ui/button";
import { zodResolver } from "@hookform/resolvers/zod";
import { AxiosError } from "axios";
import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormProvider,useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const setupSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  setupSecret: z.string().min(1, "Setup secret is required"),
});

type SetupFormData = z.infer<typeof setupSchema>;

export default function AdminSetupPage() {
  const router = useRouter();

  const methods = useForm<SetupFormData>({
    resolver: zodResolver(setupSchema),
    defaultValues: { email: "", password: "", setupSecret: "" },
  });

  const {
    handleSubmit,
    formState: { isSubmitting },
  } = methods;

  async function onSubmit(data: SetupFormData) {
    try {
      await publicApi.post<AuthResponseDto>("/admin/auth/setup", data);
      toast.success("Initial admin account created successfully! Please sign in.");
      router.push("/auth/admin/login");
    } catch (err: unknown) {
      const msg =
        (err as AxiosError<{ message: string }>)?.response?.data?.message ?? "Setup failed. Check your setup secret or existing admin status.";
      toast.error(msg);
    }
  }

  return (
    <PublicOnlyLayout>
      <div className="mx-auto max-w-md space-y-6 p-6">
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-xs">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Admin Setup</h1>
          <p className="text-sm text-muted-foreground">
            Initialize the primary system administrator account
          </p>
        </div>
        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <FormInput
              name="email"
              label="Admin Email"
              type="email"
              placeholder="admin@example.com"
            />
            <FormInput
              name="password"
              label="Password"
              type="password"
              placeholder="Min 8 characters"
            />
            <FormInput
              name="setupSecret"
              label="Setup Secret"
              type="password"
              placeholder="Enter setup secret configured in environment"
            />
            <Button type="submit" className="w-full rounded-xl" disabled={isSubmitting}>
              {isSubmitting ? "Setting up..." : "Setup Admin"}
            </Button>
          </form>
        </FormProvider>
      </div>
    </PublicOnlyLayout>
  );
}
