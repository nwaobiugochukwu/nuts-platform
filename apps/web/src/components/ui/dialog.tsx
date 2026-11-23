"use client";

import { cn } from "@/lib/util";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    showCloseButton?: boolean;
    /**
     * Phones: "sheet" (default) is a full-screen sheet for forms; "center" keeps a
     * small centred card, right for confirmations and short prompts.
     */
    mobile?: "sheet" | "center";
  }
>(({ className, children, showCloseButton = true, mobile = "sheet", ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 grid max-w-lg gap-4 border bg-background p-6 shadow-lg duration-200 sm:w-full sm:rounded-lg",
        mobile === "sheet"
          ? // Phones: a full-screen sheet (inset-0, NO translate). From `sm` up: centred.
            "nuts-dialog inset-0 w-full sm:inset-auto sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%]"
          : "left-[50%] top-[50%] max-h-[85dvh] w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] grid-cols-[minmax(0,1fr)] overflow-y-auto rounded-2xl",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && <DialogPrimitive.Close className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full opacity-70 sm:h-auto sm:w-auto sm:rounded-sm ring-offset-background transition-opacity hover:opacity-100">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left max-sm:pr-10 max-sm:text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";
const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      // Phones: actions stay pinned to the bottom of the sheet while the form scrolls.
      "max-sm:[.nuts-dialog_&]:sticky max-sm:[.nuts-dialog_&]:bottom-0 max-sm:[.nuts-dialog_&]:z-10 max-sm:[.nuts-dialog_&]:bg-background max-sm:[.nuts-dialog_&]:pt-3 max-sm:[.nuts-dialog_&]:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:[.nuts-dialog_&]:before:absolute max-sm:[.nuts-dialog_&]:before:-left-4 max-sm:[.nuts-dialog_&]:before:-right-4 max-sm:[.nuts-dialog_&]:before:top-0 max-sm:[.nuts-dialog_&]:before:bottom-0 max-sm:[.nuts-dialog_&]:before:-z-10 max-sm:[.nuts-dialog_&]:before:border-t max-sm:[.nuts-dialog_&]:before:border-border max-sm:[.nuts-dialog_&]:before:bg-background max-sm:[.nuts-dialog_&]:before:content-['']",
      className,
    )} {...props} />
);
DialogFooter.displayName = "DialogFooter";
const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />
));
DialogTitle.displayName = "DialogTitle";
const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = "DialogDescription";

export {
Dialog,DialogClose,
DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogOverlay,DialogPortal,DialogTitle,DialogTrigger
};
