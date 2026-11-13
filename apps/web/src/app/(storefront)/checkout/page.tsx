"use client";

import { RemoteImage } from "@/component/ui/RemoteImage";
import { cartService,orderService,paymentService,userService } from "@/api";
import { getApiErrorMessage } from "@/api/core/error";
import type { CheckoutPayload } from "@/api/order";
import { FormInput } from "@/component/form/FormInput";
import { CustomerLayout } from "@/component/layout/CustomerLayout";
import { Button } from "@/component/ui/button";
import { Input } from "@/component/ui/input";
import { queryKey } from "@/lib/query-key";
import { safePaystackCheckoutUrl } from "@/lib/safe-paystack-url";
import { clearClientCart } from "@/lib/cart-cleanup";
import { formatPrice } from "@/lib/util";
import { useAuthStore } from "@/zustand/auth";
import { useDiscountStore } from "@/zustand/discount";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
ArrowLeft,
CheckCircle2,
ChevronDown,
CreditCard,
Loader2,
ShoppingBag,
Tag,
Truck
} from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect,useState } from "react";
import { FormProvider,useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const addressSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  phone: z
    .string()
    .regex(
      /^\+[1-9]\d{6,14}$/,
      "Phone number must include international country code (e.g. +2349064786655)",
    ),
  street: z.string().min(4, "Street address is required"),
  city: z.string().min(2, "City is required"),
  state: z.string().min(2, "State is required"),
  country: z.string().optional().default("Nigeria"),
});

type AddressForm = z.infer<typeof addressSchema>;

export default function CheckoutPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const { appliedDiscount, setAppliedDiscount, clearDiscount } = useDiscountStore();
  const [discountCode, setDiscountCode] = useState(() => searchParams.get("code") ?? appliedDiscount?.code ?? "");
  const [isApplyingDiscount, setIsApplyingDiscount] = useState(false);
  const [addressMode, setAddressMode] = useState<"default" | "new">("default");
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [isMobileSummaryOpen, setIsMobileSummaryOpen] = useState(false);

  const authUser = useAuthStore((state) => state.user);

  // Fetch fresh user profile to read default shipping address
  const { data: userProfile } = useQuery({
    queryKey: ["user", "profile"],
    queryFn: async () => (await userService.me()).data,
    enabled: Boolean(authUser),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 15,
  });

  const defaultAddress = userProfile?.shippingInformation ?? authUser?.shippingInformation;
  const hasDefaultAddress = Boolean(defaultAddress?.street && defaultAddress?.city);

  // If user doesn't have a default address, stay in "new" address mode
  const effectiveAddressMode = hasDefaultAddress ? addressMode : "new";

  const {
    data: cartData,
    isLoading: cartLoading,
    isError: cartError,
    refetch: refetchCart,
  } = useQuery({
    queryKey: queryKey.cart,
    queryFn: async () => (await cartService.get()).data,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 20,
  });

  const form = useForm<AddressForm>({
    resolver: zodResolver(addressSchema),
    defaultValues: { country: "Nigeria" },
  });

  // Pre-fill form if user wants to edit or start from default
  useEffect(() => {
    if (defaultAddress && !form.getValues("street")) {
      form.reset({
        fullName: defaultAddress.fullName || "",
        phone: defaultAddress.phone || "",
        street: defaultAddress.street || "",
        city: defaultAddress.city || "",
        state: defaultAddress.state || "",
        country: defaultAddress.country || "Nigeria",
      });
    }
  }, [defaultAddress, form]);

  // Revalidate an applied discount code against the server before applying it.
  const appliedDiscountCode = appliedDiscount?.code;
  useEffect(() => {
    const initialCode = searchParams.get("code") ?? appliedDiscountCode ?? "";
    if (!initialCode) return;
    void cartService
      .previewDiscount(initialCode)
      .then((res) => {
        setDiscountCode(res.data.code);
        setAppliedDiscount({
          code: res.data.code,
          amount: res.data.discountAmount,
        });
        toast.success(`Discount code "${res.data.code}" applied!`);
      })
      .catch(() => {
        clearDiscount();
      })
      .finally(() => setIsApplyingDiscount(false));
  }, [searchParams, appliedDiscountCode, clearDiscount, setAppliedDiscount]);

  const checkoutMutation = useMutation({
    mutationFn: (payload: CheckoutPayload) => orderService.checkout(payload),
    onSuccess: async (res) => {
      const order = res.data;
      const orderId = order.id;
      const directUrl = order.authorizationUrl;

      // Automatically purge client cart state upon order creation
      clearClientCart(queryClient);

      // 1. Direct Paystack URL from checkout response
      if (directUrl) {
        const checkoutUrl = safePaystackCheckoutUrl(directUrl);
        if (checkoutUrl) {
          window.location.assign(checkoutUrl);
          return;
        }
      }

      // 2. Initialize Paystack gateway immediately for this order
      try {
        const initRes = await paymentService.initialize(orderId);
        const authUrl = initRes.data?.authorizationUrl;
        if (authUrl) {
          const checkoutUrl = safePaystackCheckoutUrl(authUrl);
          if (checkoutUrl) {
            window.location.assign(checkoutUrl);
            return;
          }
        }
      } catch (initErr: unknown) {
        toast.error(
          getApiErrorMessage(initErr, "Order created, but payment could not be opened. Please retry from order details.")
        );
      }

      router.push(`/order/${encodeURIComponent(orderId)}`);
    },
    onError: (err: unknown) =>
      toast.error(getApiErrorMessage(err, "Checkout failed. Please review your address.")),
  });

  const handleCheckoutSubmit = (v?: AddressForm) => {
    let shipping: AddressForm;
    if (effectiveAddressMode === "default" && defaultAddress) {
      shipping = {
        fullName: defaultAddress.fullName,
        phone: defaultAddress.phone,
        street: defaultAddress.street,
        city: defaultAddress.city,
        state: defaultAddress.state,
        country: defaultAddress.country || "Nigeria",
      };
    } else if (v) {
      shipping = v;
      if (saveAsDefault) {
        userService
          .updateShipping({
            fullName: v.fullName,
            phone: v.phone,
            street: v.street,
            city: v.city,
            state: v.state,
            country: v.country || "Nigeria",
            isDefault: true,
          })
          .catch((error: unknown) => {
            toast.error(getApiErrorMessage(error, "Your address could not be saved as default"));
          });
      }
    } else {
      return;
    }

    checkoutMutation.mutate({
      shippingAddress: shipping,
      ...(appliedDiscount ? { discountCode: appliedDiscount.code } : {}),
    });
  };

  const handleApplyDiscount = async () => {
    if (!discountCode.trim() || checkoutMutation.isPending) return;
    setIsApplyingDiscount(true);
    try {
      const res = await cartService.previewDiscount(discountCode.trim());
      const discountData = {
        code: res.data.code,
        amount: res.data.discountAmount,
      };
      setAppliedDiscount(discountData);
      toast.success(`Discount code "${res.data.code}" applied!`);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, "Invalid or expired discount code"));
      clearDiscount();
    } finally {
      setIsApplyingDiscount(false);
    }
  };

  const handleRemoveDiscount = () => {
    if (checkoutMutation.isPending) return;
    clearDiscount();
    setDiscountCode("");
    toast.info("Discount code removed");
  };

  if (cartLoading) {
    return (
      <CustomerLayout hideBottomNav>
        <div className="mx-auto max-w-7xl px-4 py-24 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-neutral-400" />
          <p className="mt-4 text-sm text-neutral-500">Preparing checkout...</p>
        </div>
      </CustomerLayout>
    );
  }

  if (cartError) {
    return (
      <CustomerLayout hideBottomNav>
        <div className="mx-auto max-w-md px-4 py-20 text-center">
          <ShoppingBag className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="mt-4 text-xl font-semibold text-foreground">
            We couldn&apos;t load your cart
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your cart has not been cleared. Try loading it again before continuing to checkout.
          </p>
          <Button
            type="button"
            onClick={() => void refetchCart()}
            className="mt-5"
          >
            Try again
          </Button>
        </div>
      </CustomerLayout>
    );
  }

  const items = cartData?.cartItems ?? [];
  const subtotal = cartData?.cart.subtotal ?? 0;
  const deliveryCharge = cartData?.cart.deliveryCharge ?? 0;
  const serviceCharge = cartData?.cart.serviceCharge ?? 0;
  const discountAmount = appliedDiscount?.amount ?? (cartData?.cart.discountAmount ?? 0);
  const totalAmount = Math.max(0, subtotal + deliveryCharge + serviceCharge - discountAmount);

  if (items.length === 0) {
    return (
      <CustomerLayout hideBottomNav>
        <div className="mx-auto max-w-md py-24 text-center px-4">
          <ShoppingBag className="mx-auto h-12 w-12 text-muted-foreground stroke-[1.2]" />
          <h1 className="mt-4 text-2xl font-semibold text-foreground">Your cart is empty</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Please add items to your cart before proceeding to checkout.
          </p>
          <Button asChild className="mt-6 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-6 text-sm font-medium">
            <Link href="/product">Browse Catalog</Link>
          </Button>
        </div>
      </CustomerLayout>
    );
  }

  return (
    <CustomerLayout hideBottomNav>
      <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8 pb-36 pt-4 sm:pt-6 lg:pb-16">
        {/* Navigation & Header */}
        <div className="mb-4 sm:mb-8 border-b border-border pb-3 sm:pb-5">
          <Link
            href="/cart"
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-1.5"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to shopping cart</span>
          </Link>
          <h1 className="text-xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-foreground">
            Checkout
          </h1>
        </div>

        {/* Mobile Expandable Order Summary Banner */}
        <div className="mb-5 rounded-2xl border border-border bg-card p-3.5 shadow-2xs lg:hidden">
          <button
            type="button"
            onClick={() => setIsMobileSummaryOpen((prev) => !prev)}
            className="flex w-full items-center justify-between text-xs font-semibold text-foreground cursor-pointer"
            aria-expanded={isMobileSummaryOpen}
          >
            <span className="flex items-center gap-2 min-w-0">
              <ShoppingBag className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate">
                {isMobileSummaryOpen ? "Hide order summary" : `Order summary (${items.length} ${items.length === 1 ? "item" : "items"})`}
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 shrink-0 ${
                  isMobileSummaryOpen ? "rotate-180" : ""
                }`}
              />
            </span>
            <span className="text-sm font-bold text-foreground shrink-0 pl-2">
              {formatPrice(totalAmount)}
            </span>
          </button>

          {isMobileSummaryOpen && (
            <div className="mt-3.5 space-y-3.5 border-t border-border/70 pt-3.5 animate-in fade-in-50 duration-150">
              {/* Items preview list */}
              <div className="max-h-60 divide-y divide-border/60 overflow-y-auto pr-1 overscroll-contain">
                {items.map((item) => {
                  const img =
                    item.product.images && item.product.images.length > 0
                      ? item.product.images[0]?.url
                      : null;

                  return (
                    <div key={item.id} className="flex items-center gap-3 py-2.5 first:pt-0">
                      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-secondary border border-border/50">
                        {img ? (
                          <RemoteImage
                            src={img}
                            alt={item.product.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                            <ShoppingBag className="h-5 w-5 stroke-[1.2]" />
                          </div>
                        )}
                        <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary text-primary-foreground px-1 text-[10px] font-bold">
                          {item.quantity}
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">
                          {item.product.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Qty: {item.quantity} × {formatPrice(item.price)}
                        </p>
                      </div>

                      <span className="text-xs font-semibold text-foreground shrink-0">
                        {formatPrice(item.price * item.quantity)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Price Breakdown in Mobile Summary */}
              <div className="space-y-1.5 border-t border-border/60 pt-2.5 text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="font-medium text-foreground">{formatPrice(subtotal)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Delivery</span>
                  <span className="font-medium text-foreground">{deliveryCharge > 0 ? formatPrice(deliveryCharge) : "₦0.00"}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Service Fee</span>
                  <span className="font-medium text-foreground">{serviceCharge > 0 ? formatPrice(serviceCharge) : "₦0.00"}</span>
                </div>
                {discountAmount > 0 && (
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-semibold">
                    <span>Discount</span>
                    <span>-{formatPrice(discountAmount)}</span>
                  </div>
                )}
              </div>

              {/* Discount Code inside Mobile Summary */}
              <div className="border-t border-border/60 pt-3">
                <label
                  htmlFor="mobile-checkout-discount-code"
                  className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5"
                >
                  Discount Code
                </label>
                {appliedDiscount ? (
                  <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Tag className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <div className="min-w-0 truncate">
                        <span className="font-semibold text-foreground uppercase">{appliedDiscount.code}</span>
                        <span className="ml-1 text-emerald-600 dark:text-emerald-400 font-semibold">(-{formatPrice(discountAmount)})</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveDiscount}
                      disabled={checkoutMutation.isPending}
                      className="text-xs text-muted-foreground hover:text-destructive transition-colors font-semibold shrink-0 pl-2 cursor-pointer disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      id="mobile-checkout-discount-code"
                      name="discountCode"
                      aria-label="Discount code"
                      placeholder="Discount code"
                      value={discountCode}
                      onChange={(e) => setDiscountCode(e.target.value)}
                      disabled={checkoutMutation.isPending || isApplyingDiscount}
                      className="h-9 rounded-xl bg-background text-xs uppercase min-w-0"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleApplyDiscount}
                      disabled={checkoutMutation.isPending || isApplyingDiscount || !discountCode.trim()}
                      className="h-9 rounded-xl px-3 text-xs font-semibold shrink-0 cursor-pointer"
                    >
                      {isApplyingDiscount ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        "Apply"
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Two-Column Checkout Layout */}
        <div className="grid items-start gap-5 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_440px] lg:gap-10">
          {/* Left Column: Checkout Steps */}
          <div className="space-y-4 sm:space-y-6">
            <FormProvider {...form}>
              <form
                id="checkout-form"
                onSubmit={
                  effectiveAddressMode === "default"
                    ? (e) => {
                        e.preventDefault();
                        handleCheckoutSubmit();
                      }
                    : form.handleSubmit(
                        (v) => handleCheckoutSubmit(v),
                        (errors) => {
                          const firstError = Object.values(errors)[0];
                          if (firstError?.message) {
                            toast.error(String(firstError.message));
                          } else {
                            toast.error("Please fill in all required shipping address fields.");
                          }
                        }
                      )
                }
                className="space-y-4 sm:space-y-6"
              >
                {/* Step 1: Delivery Address */}
                <div className="rounded-2xl sm:rounded-3xl border border-border bg-card p-4 sm:p-6 lg:p-7 shadow-xs">
                  <div className="flex items-center gap-2.5 mb-4 sm:mb-6">
                    <span className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      1
                    </span>
                    <h2 className="text-base sm:text-lg font-semibold text-foreground">
                      Shipping &amp; Delivery Address
                    </h2>
                  </div>

                  {/* Address Choice: Default vs New Address */}
                  {hasDefaultAddress && defaultAddress && (
                    <div className="mb-4 sm:mb-6 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
                        <button
                          type="button"
                          onClick={() => setAddressMode("default")}
                          className={`rounded-xl sm:rounded-2xl border p-3 sm:p-4 text-left transition-all cursor-pointer ${
                            effectiveAddressMode === "default"
                              ? "border-primary bg-primary/5 shadow-xs ring-1 ring-primary"
                              : "border-border hover:border-primary/50 bg-card"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs sm:text-sm font-semibold text-foreground truncate">
                              Default Address
                            </span>
                            {effectiveAddressMode === "default" && (
                              <span className="flex h-4 w-4 sm:h-4.5 sm:w-4.5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                                ✓
                              </span>
                            )}
                          </div>
                          <p className="mt-1 line-clamp-1 text-[11px] sm:text-xs text-muted-foreground">
                            {defaultAddress.street}, {defaultAddress.city}
                          </p>
                        </button>

                        <button
                          type="button"
                          onClick={() => setAddressMode("new")}
                          className={`rounded-xl sm:rounded-2xl border p-3 sm:p-4 text-left transition-all cursor-pointer ${
                            effectiveAddressMode === "new"
                              ? "border-primary bg-primary/5 shadow-xs ring-1 ring-primary"
                              : "border-border hover:border-primary/50 bg-card"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs sm:text-sm font-semibold text-foreground truncate">
                              New Address
                            </span>
                            {effectiveAddressMode === "new" && (
                              <span className="flex h-4 w-4 sm:h-4.5 sm:w-4.5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                                ✓
                              </span>
                            )}
                          </div>
                          <p className="mt-1 line-clamp-1 text-[11px] sm:text-xs text-muted-foreground">
                            Different location
                          </p>
                        </button>
                      </div>

                      {/* Summary of default address when selected */}
                      {effectiveAddressMode === "default" && (
                        <div className="space-y-1 rounded-xl sm:rounded-2xl border border-border bg-secondary/40 p-3 sm:p-4 text-xs sm:text-sm">
                          <div className="flex items-center justify-between">
                            <p className="font-semibold text-foreground">{defaultAddress.fullName}</p>
                            <span className="text-muted-foreground text-xs">{defaultAddress.phone}</span>
                          </div>
                          <p className="text-muted-foreground leading-relaxed pt-0.5">
                            {defaultAddress.street}, {defaultAddress.city}, {defaultAddress.state},{" "}
                            {defaultAddress.country || "Nigeria"}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Manual New Address Inputs */}
                  {effectiveAddressMode === "new" && (
                    <div className="space-y-3 sm:space-y-4">
                      {hasDefaultAddress && (
                        <p className="text-xs font-medium text-muted-foreground">
                          Enter destination details for this order:
                        </p>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                        <div className="sm:col-span-2">
                          <FormInput
                            name="fullName"
                            label="Full Name"
                            placeholder="John Doe"
                          />
                        </div>

                        <FormInput
                          name="phone"
                          label="Phone Number"
                          placeholder="+2349064786655"
                        />

                        <FormInput
                          name="city"
                          label="City"
                          placeholder="Lagos"
                        />

                        <div className="sm:col-span-2">
                          <FormInput
                            name="street"
                            label="Street Address"
                            placeholder="123 Admiralty Way, Lekki Phase 1"
                          />
                        </div>

                        <FormInput
                          name="state"
                          label="State"
                          placeholder="Lagos State"
                        />

                        <FormInput
                          name="country"
                          label="Country"
                          placeholder="Nigeria"
                        />
                      </div>

                      <div className="pt-1.5">
                        <label
                          htmlFor="save-default-address-checkbox"
                          className="flex cursor-pointer items-center gap-2 text-xs text-foreground"
                        >
                          <input
                            id="save-default-address-checkbox"
                            name="saveAsDefault"
                            type="checkbox"
                            checked={saveAsDefault}
                            onChange={(e) => setSaveAsDefault(e.target.checked)}
                            className="h-4 w-4 rounded accent-primary cursor-pointer"
                          />
                          <span>Save as my default shipping address</span>
                        </label>
                      </div>
                    </div>
                  )}
                </div>

                {/* Step 2: Delivery Method */}
                <div className="rounded-2xl sm:rounded-3xl border border-border bg-card p-4 sm:p-6 lg:p-7 shadow-xs">
                  <div className="flex items-center gap-2.5 mb-3.5 sm:mb-5">
                    <span className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      2
                    </span>
                    <h2 className="text-base sm:text-lg font-semibold text-foreground">
                      Delivery Method
                    </h2>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-xl sm:rounded-2xl border-2 border-primary bg-primary/5 p-3 sm:p-4">
                    <div className="flex min-w-0 items-center gap-2.5 sm:gap-3.5">
                      <div className="flex h-8 w-8 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Truck className="h-4 w-4 sm:h-5 sm:w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm font-semibold text-foreground truncate">
                          Standard Express Dispatch
                        </p>
                        <p className="text-[11px] sm:text-xs text-muted-foreground truncate">
                          Estimated 24 – 48 business hours
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 text-xs sm:text-sm font-bold text-foreground">
                      {deliveryCharge > 0 ? formatPrice(deliveryCharge) : "Free"}
                    </span>
                  </div>
                </div>

                {/* Step 3: Payment Gateway */}
                <div className="rounded-2xl sm:rounded-3xl border border-border bg-card p-4 sm:p-6 lg:p-7 shadow-xs">
                  <div className="flex items-center gap-2.5 mb-3.5 sm:mb-5">
                    <span className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      3
                    </span>
                    <h2 className="text-base sm:text-lg font-semibold text-foreground">
                      Payment Gateway
                    </h2>
                  </div>

                  <div className="rounded-xl sm:rounded-2xl border border-border bg-secondary/30 p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                        <CreditCard className="h-5 w-5 shrink-0 text-foreground" />
                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-bold text-foreground truncate">
                            Paystack Secure Checkout
                          </p>
                          <p className="text-[11px] sm:text-xs text-muted-foreground leading-snug">
                            Cards, bank transfer, and USSD supported.
                          </p>
                        </div>
                      </div>
                      <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5 fill-black text-white dark:fill-white dark:text-black shrink-0" />
                    </div>
                  </div>
                </div>
              </form>
            </FormProvider>
          </div>

          {/* Right Column: Sticky Order Summary (Desktop / Tablet) */}
          <aside className="hidden lg:block space-y-4 sm:space-y-6 rounded-2xl sm:rounded-3xl border border-border bg-card p-4 sm:p-6 lg:p-7 shadow-xs lg:sticky lg:top-24">
            <div className="flex items-center justify-between">
              <h2 className="text-base sm:text-lg font-bold text-foreground">
                Order Review
              </h2>
              <span className="text-xs font-semibold text-muted-foreground bg-secondary px-2.5 py-0.5 rounded-full">
                {items.length} {items.length === 1 ? "item" : "items"}
              </span>
            </div>

            {/* Itemized List with Responsive Containment */}
            <div className="max-h-64 sm:max-h-80 divide-y divide-border/60 overflow-y-auto pr-1 overscroll-contain [scrollbar-width:thin]">
              {items.map((item) => {
                const img =
                  item.product.images && item.product.images.length > 0
                    ? item.product.images[0]?.url
                    : null;

                return (
                  <div key={item.id} className="flex items-center gap-3 py-3 first:pt-0">
                    <div className="relative h-12 w-12 sm:h-14 sm:w-14 shrink-0 overflow-hidden rounded-xl bg-secondary border border-border/50">
                      {img ? (
                        <RemoteImage
                          src={img}
                          alt={item.product.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          <ShoppingBag className="h-5 w-5 stroke-[1.2]" />
                        </div>
                      )}
                      <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary text-primary-foreground px-1 text-[10px] font-bold">
                        {item.quantity}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-xs sm:text-sm font-medium text-foreground truncate">
                        {item.product.name}
                      </p>
                      <p className="text-[11px] sm:text-xs text-muted-foreground">
                        Qty: {item.quantity} × {formatPrice(item.price)}
                      </p>
                    </div>

                    <span className="text-xs sm:text-sm font-semibold text-foreground shrink-0">
                      {formatPrice(item.price * item.quantity)}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Discount Code Input / Applied State */}
            <div>
              <label
                htmlFor="checkout-discount-code"
                className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5"
              >
                Discount Code
              </label>
              {appliedDiscount ? (
                <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 sm:p-3 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <Tag className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div className="min-w-0 truncate">
                      <span className="font-semibold text-foreground uppercase">{appliedDiscount.code}</span>
                      <span className="ml-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">(-{formatPrice(discountAmount)})</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemoveDiscount}
                    disabled={checkoutMutation.isPending}
                    className="text-xs text-muted-foreground hover:text-destructive transition-colors font-semibold shrink-0 pl-2 cursor-pointer disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    id="checkout-discount-code"
                    name="discountCode"
                    aria-label="Discount code"
                    placeholder="Discount code"
                    value={discountCode}
                    onChange={(e) => setDiscountCode(e.target.value)}
                    disabled={checkoutMutation.isPending || isApplyingDiscount}
                    className="h-10 rounded-xl bg-background text-xs sm:text-sm uppercase min-w-0"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleApplyDiscount}
                    disabled={checkoutMutation.isPending || isApplyingDiscount || !discountCode.trim()}
                    className="h-10 rounded-xl px-4 text-xs sm:text-sm font-semibold shrink-0"
                  >
                    {isApplyingDiscount ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Apply"
                    )}
                  </Button>
                </div>
              )}
            </div>

            {/* Pricing Breakdown */}
            <div className="space-y-2.5 border-t border-border pt-4 text-xs sm:text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="font-semibold text-foreground">
                  {formatPrice(subtotal)}
                </span>
              </div>

              <div className="flex justify-between text-muted-foreground">
                <span>Delivery</span>
                <span className="font-semibold text-foreground">
                  {deliveryCharge > 0 ? formatPrice(deliveryCharge) : "Free"}
                </span>
              </div>

              <div className="flex justify-between text-muted-foreground">
                <span>Service Fee</span>
                <span className="font-semibold text-foreground">
                  {serviceCharge > 0 ? formatPrice(serviceCharge) : "Free"}
                </span>
              </div>

              {discountAmount > 0 && (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-semibold">
                  <span>Discount</span>
                  <span>-{formatPrice(discountAmount)}</span>
                </div>
              )}

              <div className="border-t border-border pt-3 flex justify-between text-base sm:text-lg font-bold text-foreground">
                <span>Total Due</span>
                <span>{formatPrice(totalAmount)}</span>
              </div>
            </div>

            {/* Desktop Pay Button */}
            <Button
              type="submit"
              form="checkout-form"
              disabled={checkoutMutation.isPending || isApplyingDiscount}
              className="hidden w-full rounded-full bg-primary py-6 text-sm sm:text-base font-semibold text-primary-foreground shadow-md transition-all hover:bg-primary/90 lg:flex lg:items-center lg:justify-center lg:gap-2 cursor-pointer"
            >
              {checkoutMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Processing Payment...</span>
                </>
              ) : (
                <span>Pay {formatPrice(totalAmount)}</span>
              )}
            </Button>
          </aside>
        </div>
      </div>

      {/* Mobile Fixed Bottom Payment Bar with Safe Area Support */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 pt-2.5 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-4px_20px_rgba(0,0,0,0.08)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Total due
            </p>
            <p className="truncate text-base sm:text-lg font-extrabold text-foreground">
              {formatPrice(totalAmount)}
            </p>
          </div>
          <Button
            type="button"
            onClick={() => {
              if (effectiveAddressMode === "default") {
                handleCheckoutSubmit();
              } else {
                form.handleSubmit(
                  (v) => handleCheckoutSubmit(v),
                  (errors) => {
                    const firstError = Object.values(errors)[0];
                    if (firstError?.message) {
                      toast.error(String(firstError.message));
                    } else {
                      toast.error("Please fill in all required shipping address fields.");
                    }
                  }
                )();
              }
            }}
            disabled={checkoutMutation.isPending || isApplyingDiscount}
            className="h-11 rounded-xl px-5 sm:px-6 text-xs sm:text-sm font-bold shadow-sm cursor-pointer shrink-0"
          >
            {checkoutMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Processing…</span>
              </>
            ) : (
              <span className="flex items-center gap-1.5">
                Proceed to Pay
                <CreditCard className="h-4 w-4" />
              </span>
            )}
          </Button>
        </div>
      </div>
    </CustomerLayout>
  );
}
