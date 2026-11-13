import type { CategoryResponseDto } from "@/api/dto/category";
import { BottomNav } from "@/component/layout/BottomNav";
import { Footer } from "@/component/layout/Footer";
import { Navbar } from "@/component/navbar/Navbar";
import { type ReactNode } from "react";

export function CustomerLayout({
  children,
  categories,
  hideBottomNav = false,
  showCategoryNavigation = true,
}: {
  children: ReactNode;
  categories?: CategoryResponseDto[];
  hideBottomNav?: boolean;
  showCategoryNavigation?: boolean;
}) {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground selection:bg-primary/20 selection:text-primary">
      <Navbar
        categories={categories}
        showCategoryNavigation={showCategoryNavigation}
      />
      <main className={`min-w-0 flex-1 ${hideBottomNav ? "" : "pb-[calc(4.75rem+env(safe-area-inset-bottom))] xl:pb-0"}`}>{children}</main>
      <Footer />
      {!hideBottomNav && <BottomNav />}
    </div>
  );
}
