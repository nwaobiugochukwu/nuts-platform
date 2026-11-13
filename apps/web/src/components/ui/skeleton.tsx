import { cn } from "@/lib/util";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("shimmer-wave rounded-md bg-muted/80 backdrop-blur-[2px]", className)}
      aria-hidden="true"
      {...props}
    />
  );
}

export { Skeleton };
