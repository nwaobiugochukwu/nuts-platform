"use client";

import type { CategoryResponseDto } from "@/api/dto/category";
import Link from "@/components/navigation/AppLink";
import { RemoteImage } from "@/components/ui/RemoteImage";
import { getNodeChildren } from "@/lib/category-tree";
import { ChevronRight, Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";

export function CategoryNavMenu({
  categories = [],
}: {
  categories?: CategoryResponseDto[];
}) {
  const pathname = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [hoveredRootId, setHoveredRootId] = useState<string | null>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPointerTypeRef = useRef<string | null>(null);
  const isOpen = openPath === pathname;

  const rootCategories = categories.filter((category) => !category.parentId);
  const activeRoot =
    rootCategories.find((category) => category.id === hoveredRootId) ??
    rootCategories[0] ??
    null;
  const rootChildren = getNodeChildren(activeRoot);
  const hasParentSubcategories = rootChildren.some(
    (category) =>
      category.level === "PARENT_SUBCATEGORY" || getNodeChildren(category).length > 0,
  );

  const clearCloseTimeout = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  const closeMenu = () => {
    clearCloseTimeout();
    setOpenPath(null);
  };

  const handlePointerEnter = (event: ReactPointerEvent) => {
    clearCloseTimeout();
    if (event.pointerType === "mouse") setOpenPath(pathname);
  };

  const handlePointerLeave = (event: ReactPointerEvent) => {
    if (event.pointerType !== "mouse") return;
    clearCloseTimeout();
    closeTimeoutRef.current = setTimeout(() => setOpenPath(null), 180);
  };

  const handleTriggerClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const wasKeyboardClick = event.detail === 0;
    const wasTouchClick = lastPointerTypeRef.current === "touch" ||
      lastPointerTypeRef.current === "pen" ||
      window.matchMedia("(hover: none)").matches;
    lastPointerTypeRef.current = null;

    if (wasKeyboardClick || wasTouchClick) {
      setOpenPath(isOpen ? null : pathname);
    } else if (isOpen) {
      closeMenu();
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenPath(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  return (
    <div
      className="relative flex shrink-0 items-center"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <button
        type="button"
        onClick={handleTriggerClick}
        onPointerDown={(event) => {
          lastPointerTypeRef.current = event.pointerType;
        }}
        onFocus={() => setOpenPath(pathname)}
        aria-label={isOpen ? "Close categories" : "Browse categories"}
        aria-expanded={isOpen}
        aria-controls={isOpen ? "category-navigation-panel" : undefined}
        className="flex h-10 w-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {isOpen && typeof document !== "undefined" && createPortal(
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close category menu"
            className="fixed inset-x-0 bottom-0 top-16 z-40 bg-black/25 backdrop-blur-[2px] md:hidden"
            onClick={closeMenu}
          />

          <section
            id="category-navigation-panel"
            aria-label="Browse product categories"
            className="fixed inset-x-0 bottom-0 top-16 z-50 flex overflow-hidden border-t border-border bg-background text-foreground shadow-xl md:bottom-auto md:max-h-[75vh] md:bg-background/95 md:backdrop-blur-xl"
            onPointerEnter={handlePointerEnter}
            onPointerLeave={handlePointerLeave}
            style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
          >
            <nav
              aria-label="Main categories"
              className="min-h-0 w-[clamp(7.25rem,42vw,16rem)] shrink-0 overflow-y-auto overscroll-contain border-r border-border bg-secondary/30 p-2 sm:p-3"
            >
              {rootCategories.length > 0 ? (
                <div className="flex flex-col gap-1">
                  {rootCategories.map((category) => {
                    const isSelected = activeRoot?.id === category.id;

                    return (
                      <button
                        key={category.id}
                        type="button"
                        onMouseEnter={() => setHoveredRootId(category.id)}
                        onFocus={() => setHoveredRootId(category.id)}
                        onClick={() => setHoveredRootId(category.id)}
                        aria-pressed={isSelected}
                        className={`flex min-h-10 w-full items-center gap-2 rounded-full px-2.5 text-left text-xs transition-colors sm:gap-2.5 sm:px-3 sm:text-sm ${
                          isSelected
                            ? "bg-foreground font-semibold text-background"
                            : "text-foreground hover:bg-secondary"
                        }`}
                      >
                        {category.imageUrl ? (
                          <RemoteImage
                            src={category.imageUrl}
                            alt=""
                            aria-hidden="true"
                            className="h-4 w-4 shrink-0 object-contain"
                          />
                        ) : (
                          <span
                            aria-hidden="true"
                            className="flex h-4 w-4 shrink-0 items-center justify-center text-[10px] font-bold"
                          >
                            {category.name.charAt(0)}
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate">{category.name}</span>
                        <ChevronRight
                          aria-hidden="true"
                          className={`h-3.5 w-3.5 shrink-0 ${
                            isSelected ? "text-background" : "text-muted-foreground"
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="px-2 py-3 text-xs text-muted-foreground sm:text-sm">
                  Categories are being updated. Check back soon.
                </p>
              )}
            </nav>

            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 lg:p-8">
              {activeRoot && (
                <div>
                  <div className="mb-5 sm:mb-6">
                    <Link
                      href={`/category/${activeRoot.slug}`}
                      onClick={closeMenu}
                      className="text-xl font-bold tracking-tight transition-colors hover:text-primary sm:text-2xl"
                    >
                      {activeRoot.name}
                    </Link>
                  </div>

                  {hasParentSubcategories ? (
                    <div className="grid grid-cols-1 gap-x-6 gap-y-7 min-[480px]:grid-cols-2 lg:grid-cols-3 lg:gap-x-10">
                      {rootChildren.map((parentSubcategory) => {
                        const subcategories = getNodeChildren(parentSubcategory);

                        return (
                          <section key={parentSubcategory.id} className="min-w-0 space-y-2.5">
                            <h2 className="text-sm font-semibold sm:text-base">
                              <Link
                                href={`/category/${activeRoot.slug}/${parentSubcategory.slug}`}
                                onClick={closeMenu}
                                className="transition-colors hover:text-primary"
                              >
                                {parentSubcategory.name}
                              </Link>
                            </h2>
                            {subcategories.length > 0 && (
                              <ul className="space-y-1.5">
                                {subcategories.map((subcategory) => (
                                  <li key={subcategory.id}>
                                    <Link
                                      href={`/category/${activeRoot.slug}/${parentSubcategory.slug}/${subcategory.slug}`}
                                      onClick={closeMenu}
                                      className="block break-words py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground sm:text-sm"
                                    >
                                      {subcategory.name}
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </section>
                        );
                      })}
                    </div>
                  ) : rootChildren.length > 0 ? (
                    <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 sm:grid-cols-3">
                      {rootChildren.map((subcategory) => (
                        <Link
                          key={subcategory.id}
                          href={`/category/${activeRoot.slug}/${subcategory.slug}`}
                          onClick={closeMenu}
                          className="rounded-lg px-2 py-2 text-sm font-medium transition-colors hover:bg-secondary"
                        >
                          {subcategory.name}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Browse all {activeRoot.name.toLowerCase()} products.
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>
        </>,
        document.body,
      )}
    </div>
  );
}
