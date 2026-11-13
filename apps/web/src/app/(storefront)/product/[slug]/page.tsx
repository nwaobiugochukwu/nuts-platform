import {
serverGetProductBySlug,
serverGetProductReviews,
} from "@/api/server";
import { ProductDetailView } from "@/component/product/ProductDetailView";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await serverGetProductBySlug(slug);

  if (!product) {
    return {
      title: "Product Not Found | NUTS",
    };
  }

  return {
    title: `${product.name} | NUTS Marketplace`,
    description:
      product.description || `Buy ${product.name} on NUTS Marketplace.`,
    openGraph: {
      title: product.name,
      description: product.description || undefined,
      images: product.imageUrl ? [product.imageUrl] : [],
    },
  };
}

export default async function ProductDetailPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = await serverGetProductBySlug(slug);

  if (!product) {
    notFound();
  }

  const initialReviews = await serverGetProductReviews(product.id);

  return (
    <ProductDetailView
      slug={slug}
      initialProduct={product}
      initialReviews={initialReviews}
      addedFrom="PRODUCT_PAGE"
      fullPath={`/product/${slug}`}
    />
  );
}
