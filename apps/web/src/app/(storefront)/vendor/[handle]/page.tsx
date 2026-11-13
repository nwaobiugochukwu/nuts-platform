import { serverGetCategories,serverGetVendorStore } from "@/api/server";
import { VendorStoreView } from "@/component/domain/vendor/VendorStoreView";
import { Metadata } from "next";

interface VendorStorePageProps {
  params: Promise<{ handle?: string; slug?: string }>;
}

export async function generateMetadata({
  params,
}: VendorStorePageProps): Promise<Metadata> {
  const resolvedParams = await params;
  const identifier = resolvedParams.handle || resolvedParams.slug || "";
  const { store } = await serverGetVendorStore(identifier);

  if (store) {
    return {
      title: `${store.storeName} | NUTS-P Marketplace`,
      description:
        store.storeDescription ||
        `Shop exclusive collections from ${store.storeName} on NUTS-P.`,
      openGraph: {
        title: store.storeName,
        description: store.storeDescription || undefined,
        images: store.storeLogoUrl ? [{ url: store.storeLogoUrl }] : undefined,
      },
    };
  }

  return {
    title: "Vendor Store | NUTS Marketplace",
    description: "Explore independent vendor collections on NUTS.",
  };
}

export default async function VendorStorePage({
  params,
}: VendorStorePageProps) {
  const resolvedParams = await params;
  const identifier = resolvedParams.handle || resolvedParams.slug || "";

  const [{ store, products }, categories] = await Promise.all([
    serverGetVendorStore(identifier),
    serverGetCategories(),
  ]);

  return (
    <VendorStoreView
      slug={identifier}
      initialStore={store}
      initialProducts={products}
      initialCategories={categories}
    />
  );
}