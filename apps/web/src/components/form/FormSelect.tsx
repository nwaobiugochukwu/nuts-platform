"use client";

import { Label } from "@/component/ui/label";
import { cn } from "@/lib/util";
import { useFormContext,type FieldError } from "react-hook-form";

interface FormSelectProps {
  name: string;
  label: string;
  options?: { value: string; label: string }[];
  option?: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
  required?: boolean;
}

export function FormSelect({
  name,
  label,
  options,
  option,
  placeholder,
  className,
  required,
}: FormSelectProps) {
  const {
    register,
    formState: { errors },
  } = useFormContext();
  const error = errors[name] as FieldError | undefined;
  const items = options ?? option ?? [];

  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={name}>
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <select
        id={name}
        aria-invalid={error ? "true" : "false"}
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        {...register(name)}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {items.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p className="text-sm text-destructive">{error.message}</p>}
    </div>
  );
}
