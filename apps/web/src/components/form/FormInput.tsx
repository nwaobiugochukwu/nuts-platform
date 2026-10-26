"use client";

import { Input } from "@/component/ui/input";
import { Label } from "@/component/ui/label";
import { cn } from "@/lib/util";
import { Eye,EyeOff } from "lucide-react";
import { useState } from "react";
import { useFormContext,type FieldError } from "react-hook-form";

interface FormInputProps {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  hint?: string;
  disabled?: boolean;
  autoComplete?: string;
  required?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
}

// Helper to resolve nested errors like 'shippingAddress.street'
function getNestedError(errors: Record<string, unknown>, path: string): FieldError | undefined {
  const parts = path.split(".");
  let current: unknown = errors;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current as FieldError | undefined;
}

export function FormInput({
  name,
  label,
  type = "text",
  placeholder,
  className,
  inputClassName,
  hint,
  disabled,
  autoComplete,
  required,
  maxLength,
  autoFocus,
}: FormInputProps) {
  const {
    register,
    formState: { errors },
  } = useFormContext();

  const [showPassword, setShowPassword] = useState(false);
  const isPasswordField = type === "password";
  const inputType = isPasswordField ? (showPassword ? "text" : "password") : type;

  const error = getNestedError(errors, name);

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <div className="flex items-center justify-between">
          <Label htmlFor={name} className="text-xs sm:text-sm font-semibold text-foreground/90">
            {label}
            {required && <span className="text-destructive ml-1">*</span>}
          </Label>
          {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
        </div>
      )}
      <div className="relative">
        <Input
          id={name}
          type={inputType}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete={autoComplete}
          maxLength={maxLength}
          autoFocus={autoFocus}
          aria-invalid={error ? "true" : "false"}
          className={cn(
            "h-11 sm:h-12 px-3.5 sm:px-4 text-sm sm:text-base rounded-xl border-input/80 bg-background/70 shadow-xs transition-all duration-200 hover:border-input focus:bg-background focus:border-primary focus-visible:ring-4 focus-visible:ring-primary/10",
            isPasswordField && "pr-11",
            error && "border-destructive/80 bg-destructive/[0.02] focus-visible:ring-destructive/20",
            inputClassName
          )}
          {...register(name)}
        />
        {isPasswordField && (
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            tabIndex={-1}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors p-1.5 rounded-lg focus:outline-hidden"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4 sm:h-5 sm:w-5" />
            ) : (
              <Eye className="h-4 w-4 sm:h-5 sm:w-5" />
            )}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-destructive mt-1 font-medium">{error.message}</p>}
    </div>
  );
}
