export const queryKey = {
  session: ["session"] as const,
  product: {
    all: ["product"] as const,
    list: (params?: Record<string, unknown>) => ["product", "list", params] as const,
    detail: (slug: string) => ["product", "detail", slug] as const,
    related: (productId: string) => ["product", "related", productId] as const,
    review: (productId: string) => ["product", "review", productId] as const,
  },
  category: {
    all: ["category"] as const,
    list: () => ["category", "list"] as const,
    detail: (slug: string) => ["category", "detail", slug] as const,
  },
  vendor: {
    all: ["vendor"] as const,
    list: (params?: Record<string, unknown>) => ["vendor", "list", params] as const,
    store: (slug: string) => ["vendor", "store", slug] as const,
    analytic: ["vendor", "analytic"] as const,
    product: ["vendor", "product"] as const,
    order: ["vendor", "order"] as const,
    wallet: ["vendor", "wallet"] as const,
    discount: ["vendor", "discount"] as const,
    profile: ["vendor", "profile"] as const,
  },
  cart: ["cart"] as const,
  order: {
    all: ["order"] as const,
    list: (params?: Record<string, unknown>) =>
      params ? (["order", "list", params] as const) : (["order", "list"] as const),
    detail: (id: string) => ["order", "detail", id] as const,
  },
  wishlist: ["wishlist"] as const,
  notification: {
    all: ["notification"] as const,
    preferences: (userId?: string) =>
      ["notification", "preferences", userId ?? "me"] as const,
    detail: (sessionKey: string, id: string) =>
      ["notification", "detail", sessionKey, id] as const,
  },
  wallet: ["wallet"] as const,
  review: {
    all: ["review"] as const,
    my: ["review", "my"] as const,
  },
  admin: {
    analytic: ["admin", "analytic"] as const,
    product: ["admin", "product"] as const,
    category: ["admin", "category"] as const,
    order: ["admin", "order"] as const,
    user: ["admin", "user"] as const,
    vendor: ["admin", "vendor"] as const,
    discount: ["admin", "discount"] as const,
    staff: ["admin", "staff"] as const,
    platform: ["admin", "platform"] as const,
    announcements: ["admin", "announcements"] as const,
  },
  dashboard: {
    analytic: ["vendor", "analytic"] as const,
    product: ["vendor", "product"] as const,
    order: ["vendor", "order"] as const,
    wallet: ["vendor", "wallet"] as const,
    discount: ["vendor", "discount"] as const,
  },
  user: {
    all: ["user"] as const,
    profile: ["user", "profile"] as const,
    address: ["user", "address"] as const,
  },
};
