import type { CategoryResponseDto } from "@/api/dto/category";
import type { PublicPlatformPromoDto } from "@/api/dto/discount";
import { BottomNav } from "@/components/layout/BottomNav";
import { Footer } from "@/components/layout/Footer";
import { Navbar } from "@/components/navbar/Navbar";
import { type ReactNode } from "react";

export function CustomerLayout({
  children,
  categories,
  initialPromos,
  hideBottomNav = false,
  showCategoryNavigation = true,
}: {
  children: ReactNode;
  categories?: CategoryResponseDto[];
  initialPromos?: PublicPlatformPromoDto[];
  hideBottomNav?: boolean;
  showCategoryNavigation?: boolean;
}) {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground selection:bg-primary/20 selection:text-primary">
      <Navbar
        categories={categories}
        showCategoryNavigation={showCategoryNavigation}
        initialPromos={initialPromos}
      />
      <main className={`min-w-0 flex-1 ${hideBottomNav ? "" : "pb-[calc(4.75rem+env(safe-area-inset-bottom))] xl:pb-0"}`}>{children}</main>
      <Footer />
      {!hideBottomNav && <BottomNav />}
    </div>
  );
}
