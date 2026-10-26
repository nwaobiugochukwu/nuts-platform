"use client";

import { Label } from "@/component/ui/label";
import { cn } from "@/lib/util";
import { useFormContext,type FieldError } from "react-hook-form";

interface FormTextareaProps {
  name: string;
  label: string;
  placeholder?: string;
  rows?: number;
  className?: string;
  textareaClassName?: string;
  required?: boolean;
}

export function FormTextarea({
  name,
  label,
  placeholder,
  rows = 4,
  className,
  textareaClassName,
  required,
}: FormTextareaProps) {
  const {
    register,
    formState: { errors },
  } = useFormContext();
  const error = errors[name] as FieldError | undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={name} className="text-xs sm:text-sm font-semibold text-foreground/90">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <textarea
        id={name}
        rows={rows}
        placeholder={placeholder}
        aria-invalid={error ? "true" : "false"}
        className={cn(
          "flex w-full rounded-xl border border-input/80 bg-background/70 px-3.5 py-3 text-sm sm:text-base shadow-xs placeholder:text-muted-foreground/60 transition-all duration-200 hover:border-input focus:bg-background focus:border-primary focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-destructive/80 bg-destructive/[0.02] focus-visible:ring-destructive/20",
          textareaClassName
        )}
        {...register(name)}
      />
      {error && <p className="text-xs text-destructive mt-1 font-medium">{error.message}</p>}
    </div>
  );
}
