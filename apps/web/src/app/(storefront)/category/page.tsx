import { serverGetCategories } from "@/api/server";
import type { CategoryResponseDto } from "@/api/dto/category";
import { CustomerLayout } from "@/component/layout/CustomerLayout";
import { RemoteImage } from "@/component/ui/RemoteImage";
import Link from "@/components/navigation/AppLink";
import { getNodeChildren } from "@/lib/category-tree";
import { ArrowUpRight, Shapes } from "lucide-react";

function isVisibleCategory(category: CategoryResponseDto) {
  return category.isActive && category.status === "ACTIVE";
}

export default async function CategoryIndexPage() {
  const categories = await serverGetCategories();
  const rootCategories = categories.filter(
    (category) => isVisibleCategory(category) && (!category.parentId || category.isRoot),
  );

  return (
    <CustomerLayout categories={categories}>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground sm:text-5xl">
          All categories
        </h1>

        {rootCategories.length > 0 ? (
          <div className="mt-8 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {rootCategories.map((category) => {
              const categoryHref = `/category/${encodeURIComponent(category.slug)}`;
              const children = getNodeChildren(category).filter(isVisibleCategory);

              return (
                <section key={category.id} aria-labelledby={`category-${category.id}`}>
                  <Link href={categoryHref} className="group relative block aspect-[1.8/1] overflow-hidden rounded-2xl bg-secondary">
                    {category.imageUrl ? (
                      <RemoteImage
                        src={category.imageUrl}
                        alt=""
                        aria-hidden="true"
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <Shapes className="absolute right-5 top-5 h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
                    )}
                    <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" aria-hidden="true" />
                    <span id={`category-${category.id}`} className="absolute inset-x-5 bottom-4 flex items-end justify-between gap-3 text-lg font-semibold text-white sm:text-xl">
                      {category.name}
                      <ArrowUpRight className="h-5 w-5 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
                    </span>
                  </Link>

                  {children.length > 0 && (
                    <nav aria-label={`${category.name} subcategories`} className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
                      {children.map((child) => (
                        <Link
                          key={child.id}
                          href={`${categoryHref}/${encodeURIComponent(child.slug)}`}
                          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                        >
                          {child.name}
                        </Link>
                      ))}
                    </nav>
                  )}
                </section>
              );
            })}
          </div>
        ) : (
          <p className="mt-8 text-sm text-muted-foreground">Categories are being updated.</p>
        )}
      </div>
    </CustomerLayout>
  );
}
