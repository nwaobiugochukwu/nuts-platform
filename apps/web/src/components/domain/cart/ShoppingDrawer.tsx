"use client";
// @refresh reset

import { RemoteImage } from "@/component/ui/RemoteImage";
import { cartService,orderService,paymentService,userService } from "@/api";
import type {
CartItemResponseDto,
DiscountPreviewDto,
} from "@/api/dto/cart";
import type { CheckoutResponseDto } from "@/api/dto/order";
import type { PaymentResponseDto } from "@/api/dto/payment";
import type { CheckoutPayload } from "@/api/order";
import { Button } from "@/component/ui/button";
import { Dialog,DialogContent,DialogDescription,DialogTitle } from "@/component/ui/dialog";
import { Input } from "@/component/ui/input";
import { useCart } from "@/hook/use-cart";
import { useDiscountStore } from "@/zustand/discount";
import { useWishlist } from "@/hook/use-wishlist";
import { queryKey } from "@/lib/query-key";
import { safePaystackCheckoutUrl } from "@/lib/safe-paystack-url";
import { clearClientCart } from "@/lib/cart-cleanup";
import { formatPrice } from "@/lib/util";
import { useShoppingDrawerStore } from "@/zustand/shopping-drawer";
import { useAuthStore } from "@/zustand/auth";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import { Heart,Minus,Plus,ShoppingBag,Trash2,X } from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { extractStockConflict } from "@/lib/stock-conflict";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

type Address = { fullName: string; phone: string; street: string; city: string; state: string; country: string };
const blankAddress: Address = { fullName: "", phone: "", street: "", city: "", state: "", country: "Nigeria" };

function CartLine({ item }: { item: CartItemResponseDto; cartAddedFrom?: unknown }) {
  const { updateItem, removeItem } = useCart();
  const pending = updateItem.isPending || removeItem.isPending;
  const productHref = `/product/${item.product.slug}`;
  const closeDrawer = () => useShoppingDrawerStore.getState().close();

  return (
    <div className="flex gap-3 py-4">
      <Link
        href={productHref}
        onClick={closeDrawer}
        className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl bg-secondary/60 block hover:opacity-90 transition-opacity"
      >
        {item.product.images?.[0]?.url ? (
          <RemoteImage src={item.product.images[0].url} alt={item.product.name} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center">
            <ShoppingBag className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          href={productHref}
          onClick={closeDrawer}
          className="line-clamp-1 text-sm font-semibold hover:text-primary transition-colors block"
        >
          {item.product.name}
        </Link>
        {item.variant?.options?.length ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {item.variant.options.map((option) => option.value).join(" · ")}
          </p>
        ) : null}
        {(() => {
          const inStock = item.product.inStockQuantity ?? 999;
          const isOutOfStock = inStock <= 0;
          const isLowStock = !isOutOfStock && (item.product.lowStockAlert || inStock <= 5);
          if (isOutOfStock) {
            return (
              <span className="mt-0.5 inline-block text-[11px] font-semibold text-destructive">
                Out of stock
              </span>
            );
          }
          if (isLowStock) {
            return (
              <span className="mt-0.5 inline-block text-[11px] font-medium text-amber-600 dark:text-amber-400">
                Only {inStock} left
              </span>
            );
          }
          return null;
        })()}
        <p className="mt-1 text-sm font-bold">{formatPrice(item.price)}</p>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center rounded-lg border border-border bg-background">
            <button
              aria-label="Decrease quantity"
              disabled={pending}
              onClick={() => updateItem.mutate({ productId: item.productId, delta: -1, variantId: item.variant?.id })}
              className="grid h-7 w-7 place-items-center hover:bg-secondary disabled:opacity-40"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="w-7 text-center text-xs font-bold">{item.quantity}</span>
            {(() => {
              const inStock = item.product.inStockQuantity ?? 999;
              const isMaxStockReached = item.quantity >= inStock;
              return (
                <button
                  aria-label="Increase quantity"
                  disabled={pending || isMaxStockReached}
                  title={isMaxStockReached ? `Maximum available stock reached (${inStock})` : undefined}
                  onClick={() => updateItem.mutate({ productId: item.productId, delta: 1, variantId: item.variant?.id })}
                  className="grid h-7 w-7 place-items-center hover:bg-secondary disabled:opacity-40"
                >
                  <Plus className="h-3 w-3" />
                </button>
              );
            })()}
          </div>
          <button
            aria-label="Remove from cart"
            disabled={pending}
            onClick={() => removeItem.mutate({ productId: item.productId, variantId: item.variant?.id })}
            className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

const PAYMENT_POLL_INTERVAL_MS = 2000;
const PAYMENT_POLL_TIMEOUT_MS = 5 * 60 * 1000;

function pollForPaymentCompletion(
  reference: string,
  onSuccess: () => Promise<void>
) {
  const deadline = Date.now() + PAYMENT_POLL_TIMEOUT_MS;

  const poll = async () => {
    let verification: PaymentResponseDto;
    try {
      ({ data: verification } = await paymentService.verify(reference));
    } catch {
      if (Date.now() >= deadline) {
        toast.info("Payment is still being confirmed. Check your orders shortly.");
        return;
      }
      window.setTimeout(() => void poll(), PAYMENT_POLL_INTERVAL_MS);
      return;
    }

    if (verification.status === "SUCCESS") {
      await onSuccess();
      return;
    }

    if (["FAILED", "CANCELLED", "REFUNDED"].includes(verification.status)) {
      toast.error("Payment was not completed. You can retry it from your orders.");
      return;
    }

    if (Date.now() >= deadline) {
      toast.info("Payment is still being confirmed. Check your orders shortly.");
      return;
    }
    window.setTimeout(() => void poll(), PAYMENT_POLL_INTERVAL_MS);
  };

  window.setTimeout(() => void poll(), PAYMENT_POLL_INTERVAL_MS);
}

async function resolvePaymentInitialization(order: CheckoutResponseDto): Promise<{ accessCode?: string; reference?: string; redirectUrl?: string }> {
  // Preferred path: the checkout response already carries Paystack details.
  if (order.paystackAccessCode && order.paymentReference) {
    return { accessCode: order.paystackAccessCode, reference: order.paymentReference };
  }

  // Fallback: fetch the payment record for this order and redirect to its link.
  const payment = await paymentService.getByOrderId(order.id);
  const data = payment.data;
  if (data?.paymentLink && data.transactionReference) {
    return { reference: data.transactionReference, redirectUrl: data.paymentLink };
  }

  throw new Error("Payment could not be initialized for this order");
}

function CheckoutPanel({ total, discountCode, discountPreview }: { total: number; discountCode: string; discountPreview: DiscountPreviewDto | null }) {
  const queryClient = useQueryClient(); const [useAlternative, setUseAlternative] = useState(false); const [alternative, setAlternative] = useState<Address>(blankAddress);
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { data: user, isLoading } = useQuery({
    queryKey: queryKey.user.profile,
    queryFn: async () => (await userService.me()).data,
    enabled: isAuthenticated,
  });
  const defaultAddress = user?.shippingInformation; const selectedAddress = useAlternative ? alternative : defaultAddress; const alternativeComplete = Object.values(alternative).every(Boolean); const payable = discountPreview?.totalAmount ?? total;
  const checkout = useMutation({
    mutationFn: () => {
      if (!selectedAddress) throw new Error("Select a delivery address");
      const { fullName, phone, street, city, state, country } = selectedAddress;
      if (!/^\+[1-9]\d{6,14}$/.test(phone.trim())) {
        throw new Error("Phone number must include international country code (e.g. +2349064786655)");
      }
      return orderService.checkout({ shippingAddress: { fullName, phone: phone.trim(), street, city, state, country }, ...(discountCode.trim() ? { discountCode: discountCode.trim() } : {}) } as CheckoutPayload);
    },
    onSuccess: async ({ data: order }) => {
      try {
        clearClientCart(queryClient);
        const initialized = await resolvePaymentInitialization(order);
        if (!initialized.reference) throw new Error("Payment initialization did not return a reference");

        if (initialized.redirectUrl) {
          const checkoutUrl = safePaystackCheckoutUrl(initialized.redirectUrl);
          if (!checkoutUrl) throw new Error("Invalid Paystack checkout URL");
          useShoppingDrawerStore.getState().close();
          window.location.assign(checkoutUrl);
          return;
        }

        if (!initialized.accessCode) throw new Error("Secure payment is still loading");
        const PaystackPopup = (window as typeof window & { PaystackPop?: new () => { resumeTransaction: (code: string) => void } }).PaystackPop;
        if (!PaystackPopup) throw new Error("Secure payment is still loading");
        useShoppingDrawerStore.getState().close(); new PaystackPopup().resumeTransaction(initialized.accessCode);
        pollForPaymentCompletion(initialized.reference, async () => {
          queryClient.removeQueries({ queryKey: queryKey.cart });
          await queryClient.invalidateQueries({ queryKey: queryKey.order.all });
          router.push(`/order-success?orderId=${encodeURIComponent(order.id)}`);
        });
      } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to start secure payment"); }
    },
    onError: (error) => {
      const conflict = extractStockConflict(error);
      if (conflict) {
        queryClient.invalidateQueries({ queryKey: queryKey.cart });
        toast.error(conflict.message);
        useShoppingDrawerStore.getState().close();
        router.push("/cart");
      } else {
        toast.error(error instanceof Error ? error.message : "Unable to start checkout");
      }
    },
  });
  if (isLoading) return <div className="p-5"><div className="h-28 animate-pulse rounded-xl bg-muted" /></div>;
  const setField = (field: keyof Address, value: string) => setAlternative((current) => ({ ...current, [field]: value }));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {defaultAddress && (
          <button
            type="button"
            onClick={() => setUseAlternative(false)}
            className={`w-full rounded-2xl border p-4 text-left ${
              !useAlternative ? "border-primary bg-primary/5" : "border-border"
            }`}
          >
            <p className="text-sm font-bold">Use default delivery address</p>
            <p className="mt-3 text-sm font-medium">{defaultAddress.fullName}</p>
            <p className="text-sm text-muted-foreground">
              {defaultAddress.street}, {defaultAddress.city}, {defaultAddress.state}
            </p>
            <p className="text-sm text-muted-foreground">{defaultAddress.phone}</p>
          </button>
        )}
        <div
          className={`rounded-2xl border p-4 ${
            useAlternative ? "border-primary bg-primary/5" : "border-border"
          }`}
        >
          <label
            htmlFor="shipping-alternative-radio"
            className="flex cursor-pointer items-center gap-3 text-sm font-bold"
          >
            <input
              id="shipping-alternative-radio"
              name="shippingMethod"
              type="radio"
              checked={useAlternative}
              onChange={() => setUseAlternative(true)}
              className="accent-primary"
            />
            Deliver to a different address
          </label>
          {useAlternative && (
            <div className="mt-4 grid gap-3">
              <Input
                id="shipping-full-name"
                name="fullName"
                aria-label="Full name"
                placeholder="Full name"
                value={alternative.fullName}
                onChange={(e) => setField("fullName", e.target.value)}
              />
              <Input
                id="shipping-phone"
                name="phone"
                aria-label="Phone number"
                placeholder="Phone number (e.g. +2349064786655)"
                value={alternative.phone}
                onChange={(e) => setField("phone", e.target.value)}
              />
              <Input
                id="shipping-street"
                name="street"
                aria-label="Street address"
                placeholder="Street address"
                value={alternative.street}
                onChange={(e) => setField("street", e.target.value)}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  id="shipping-city"
                  name="city"
                  aria-label="City"
                  placeholder="City"
                  value={alternative.city}
                  onChange={(e) => setField("city", e.target.value)}
                />
                <Input
                  id="shipping-state"
                  name="state"
                  aria-label="State"
                  placeholder="State"
                  value={alternative.state}
                  onChange={(e) => setField("state", e.target.value)}
                />
              </div>
              <Input
                id="shipping-country"
                name="country"
                aria-label="Country"
                placeholder="Country"
                value={alternative.country}
                onChange={(e) => setField("country", e.target.value)}
              />
            </div>
          )}
        </div>
        <div className="space-y-2 border-t pt-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatPrice(discountPreview?.subtotal ?? total)}</span>
          </div>
          {discountPreview && discountPreview.discountAmount > 0 && (
            <div className="flex justify-between text-emerald-600">
              <span>Discount</span>
              <span>-{formatPrice(discountPreview.discountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Delivery</span>
            <span>{formatPrice(discountPreview?.deliveryCharge ?? 0)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Service</span>
            <span>{formatPrice(discountPreview?.serviceCharge ?? 0)}</span>
          </div>
          <div className="flex justify-between border-t pt-2 text-base font-bold">
            <span>Total</span>
            <span>{formatPrice(payable)}</span>
          </div>
        </div>
      </div>
      <div className="border-t p-5">
        <Button
          className="w-full"
          disabled={checkout.isPending || !alternativeComplete}
          onClick={() => checkout.mutate()}
        >
          {checkout.isPending ? "Processing..." : "Pay Now"}
        </Button>
      </div>
    </div>
  );
}

export function ShoppingDrawer() {
  const panel = useShoppingDrawerStore((state) => state.panel);
  const close = useShoppingDrawerStore((state) => state.close);
  const [discountCode, setDiscountCode] = useState("");
  const [discountPreview, setDiscountPreview] = useState<DiscountPreviewDto | null>(null);
  const { appliedDiscount, setAppliedDiscount, clearDiscount } = useDiscountStore();
  const effectiveDiscountCode = discountCode || appliedDiscount?.code || "";
  const { items: wishlist, removeItem } = useWishlist();
  const {
    items: cartItems,
    cart,
    isLoading,
    clearCart,
    addItem: addToCart,
  } = useCart();

  const previewDiscount = useMutation({
    mutationFn: (code: string) => cartService.previewDiscount(code).then((res) => res.data),
    onSuccess: (data) => {
      setDiscountPreview(data);
      setAppliedDiscount({ code: data.code, amount: data.discountAmount });
    },
    onError: () => {
      setDiscountPreview(null);
      clearDiscount();
      toast.error("Discount code could not be applied");
    },
  });

  const handleApplyDiscount = () => {
    const code = effectiveDiscountCode.trim();
    if (!code) {
      setDiscountPreview(null);
      clearDiscount();
      return;
    }
    previewDiscount.mutate(code);
  };

  const isCart = panel === "cart";
  const isCheckout = panel === "checkout";
  const title = isCheckout ? "Checkout" : isCart ? "Your cart" : "Saved items";
  const displayedSubtotal = discountPreview?.subtotal ?? cart?.subtotal ?? 0;
  const displayedTotal = discountPreview?.totalAmount ?? cart?.totalAmount ?? 0;

  return (
    <Dialog open={panel !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent
        showCloseButton={false}
        className="fixed inset-y-0 right-0 left-auto flex h-dvh w-full max-w-md translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-l p-0 shadow-2xl sm:max-w-lg"
      >
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {isCheckout
                ? "Review delivery and proceed to payment"
                : isCart
                  ? `${cart?.totalItemCount ?? 0} item${(cart?.totalItemCount ?? 0) === 1 ? "" : "s"} ready when you are`
                  : `${wishlist.length} saved for later`}
            </DialogDescription>
          </div>
          <button onClick={close} aria-label="Close" className="rounded-full p-2 text-muted-foreground hover:bg-secondary">
            <X className="h-5 w-5" />
          </button>
        </div>
        {isCheckout ? (
          <CheckoutPanel total={cart?.totalAmount ?? 0} discountCode={discountPreview ? effectiveDiscountCode : ""} discountPreview={discountPreview} />
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-5">
              {isCart
                ? isLoading
                  ? (
                    <div className="space-y-4 py-5">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-22 animate-pulse rounded-xl bg-muted" />
                      ))}
                    </div>
                  )
                  : cartItems.length
                    ? (
                      <div className="divide-y">
                        {cartItems.map((item) => (
                          <CartLine item={item} cartAddedFrom={cart?.addedFrom} key={item.id} />
                        ))}
                      </div>
                    )
                    : <Empty icon={<ShoppingBag />} title="Your cart is empty" text="Add something wonderful and it will appear here." />
                : wishlist.length
                  ? (
                    <div className="divide-y">
                      {wishlist.map((item) => (
                        <div className="flex gap-3 py-4" key={item.productId}>
                          <div className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl bg-secondary/60">
                            {item.image && <RemoteImage src={item.image} alt="" className="h-full w-full object-cover" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-1 text-sm font-semibold">{item.name}</p>
                            <p className="mt-1 text-sm font-bold">{formatPrice(item.price)}</p>
                            <div className="mt-2 flex items-center justify-between">
                              <Button
                                size="sm"
                                disabled={addToCart.isPending}
                                onClick={() =>
                                  addToCart.mutate(
                                    {
                                      productId: item.productId,
                                      quantity: 1,
                                      price: item.price,
                                      productName: item.name,
                                      productSlug: item.slug,
                                      addedFrom: "PRODUCT_PAGE",
                                    },
                                    {
                                      onSuccess: () => toast.success(`Added "${item.name}" to cart!`),
                                      onError: (error: unknown) =>
                                        toast.error(error instanceof Error ? error.message : "Unable to add this item to your cart"),
                                    }
                                  )
                                }
                                className="h-8 rounded-lg text-xs"
                              >
                                Add to cart
                              </Button>
                              <button
                                onClick={() => removeItem(item.productId)}
                                aria-label="Remove from wishlist"
                                className="rounded-full p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              >
                                <Heart className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                  : <Empty icon={<Heart />} title="No saved items" text="Tap the heart on any product to save it here." />}
            </div>
            {isCart && (
              <div className="border-t bg-card p-5">
                <div className="mb-2 flex items-center gap-2">
                  <Input
                    id="drawer-discount-code"
                    name="discountCode"
                    aria-label="Discount code"
                    value={effectiveDiscountCode}
                    onChange={(e) => setDiscountCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleApplyDiscount();
                      }
                    }}
                    placeholder="Discount code"
                    className="h-9 text-sm"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9"
                    disabled={!effectiveDiscountCode.trim() || previewDiscount.isPending}
                    onClick={handleApplyDiscount}
                  >
                    {previewDiscount.isPending ? "Applying..." : "Apply"}
                  </Button>
                </div>
                <div className="space-y-1.5 border-t pt-3 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span>{formatPrice(displayedSubtotal)}</span>
                  </div>
                  {discountPreview && discountPreview.discountAmount > 0 && (
                    <div className="flex justify-between text-emerald-600">
                      <span>Discount</span>
                      <span>-{formatPrice(discountPreview.discountAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-muted-foreground">
                    <span>Delivery</span>
                    <span>{formatPrice(discountPreview?.deliveryCharge ?? cart?.deliveryCharge ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Service</span>
                    <span>{formatPrice(discountPreview?.serviceCharge ?? cart?.serviceCharge ?? 0)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2 font-bold">
                    <span>Total</span>
                    <span>{formatPrice(displayedTotal)}</span>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button onClick={() => useShoppingDrawerStore.setState({ panel: "checkout" })} className="w-full">
                    Checkout
                  </Button>
                  <Button variant="outline" onClick={() => useShoppingDrawerStore.setState({ panel: "wishlist" })} className="w-full">
                    Saved <Heart className="ml-1 h-4 w-4 text-rose-500" />
                  </Button>
                </div>
                <button
                  type="button"
                  onClick={() => clearCart.mutate()}
                  className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-destructive"
                >
                  Clear cart
                </button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Empty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="grid min-h-80 place-items-center text-center">
      <div>
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">{icon}</div>
        <p className="mt-4 font-semibold">{title}</p>
        <p className="mx-auto mt-1 max-w-60 text-sm text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}
