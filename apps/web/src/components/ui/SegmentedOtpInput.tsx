"use client";

import React, { useRef, useState } from "react";

export interface SegmentedOtpInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  error?: boolean | string;
  onComplete?: (value: string) => void;
  className?: string;
  ariaLabel?: string;
}

export function SegmentedOtpInput({
  id = "segmented-otp-input",
  value,
  onChange,
  length = 6,
  disabled = false,
  autoFocus = false,
  error,
  onComplete,
  className = "",
  ariaLabel = "Verification Code",
}: SegmentedOtpInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  const cleanValue = (value || "").replace(/\D/g, "").slice(0, length);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const clean = raw.replace(/\D/g, "").slice(0, length);
    onChange(clean);
    if (clean.length === length && onComplete) {
      onComplete(clean);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && cleanValue.length > 0) {
      // standard backspace handled by native input
    }
  };

  return (
    <div className={`relative max-w-sm mx-auto select-none ${className}`}>
      {/* Invisible overlay input capturing native mobile numeric keyboards & paste */}
      <input
        ref={inputRef}
        id={id}
        name="otpCode"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={length}
        disabled={disabled}
        autoFocus={autoFocus}
        value={cleanValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        className="absolute inset-0 w-full h-full opacity-0 z-10 cursor-pointer disabled:cursor-not-allowed"
        aria-label={ariaLabel}
        aria-invalid={Boolean(error)}
      />

      {/* Visual Segmented 6-Box Cells */}
      <div className="flex items-center justify-between gap-2 sm:gap-2.5">
        {Array.from({ length }, (_, index) => {
          const char = cleanValue[index];
          const isCurrentActive =
            isFocused &&
            (cleanValue.length === index ||
              (cleanValue.length === length && index === length - 1));

          const hasError = Boolean(error);

          return (
            <div
              key={index}
              onClick={() => inputRef.current?.focus()}
              className={`flex h-12 w-10 sm:h-14 sm:w-12 items-center justify-center rounded-2xl border text-xl sm:text-2xl font-bold font-mono transition-all duration-200 ${
                hasError
                  ? "border-destructive/80 bg-destructive/5 text-destructive ring-1 ring-destructive/30"
                  : char
                    ? "border-primary bg-primary/5 text-foreground shadow-xs ring-1 ring-primary/20"
                    : isCurrentActive
                      ? "border-primary ring-2 ring-primary/30 bg-card text-foreground scale-[1.02]"
                      : "border-border/80 bg-muted/20 text-muted-foreground hover:border-border"
              } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              {char ||
                (isCurrentActive ? (
                  <span className="animate-pulse text-primary font-normal text-xl leading-none">
                    |
                  </span>
                ) : (
                  <span className="text-muted-foreground/30 text-xs">•</span>
                ))}
            </div>
          );
        })}
      </div>

      {typeof error === "string" && error && (
        <p className="mt-2 text-center text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
