import { adminApi, publicApi, userApi, vendorApi } from "@/api/core/client";
import type { ApiResult } from "@/api/core/client";
import type { PublicProductResponseDto } from "@/api/dto/product";
import type {
AdminVendorResponseDto,
FeaturedVendorDto,
FollowedVendorDto,
FollowedVendorsPageDto,
FollowedVendorsMetaDto,
VendorProfileDto,
VendorResponseDto,
VendorStoreDto,
VendorFollowerCountDto,
VendorWalletResponseDto,
} from "@/api/dto/vendor";
import type { WalletTransactionResponseDto } from "@/api/dto/vendor";
import type { ProductQueryParams } from "./product";

export const publicVendorService = {
  list(params?: ProductQueryParams, signal?: AbortSignal) {
    return publicApi.get<VendorResponseDto[]>("/vendors/store", { params, signal });
  },
  getStore(slug: string) {
    return publicApi.get<VendorStoreDto>(`/vendors/store/${slug}`);
  },
  getProducts(slug: string, params?: ProductQueryParams) {
    return publicApi.get<{ store: VendorStoreDto; products: PublicProductResponseDto[] }>(`/vendors/store/${slug}/products`, {
      params,
    });
  },
  featured(limit = 8, signal?: AbortSignal) {
    return publicApi.get<FeaturedVendorDto[]>("/vendors/store/featured", { params: { limit }, signal });
  },
  followerCount(slug: string, signal?: AbortSignal) {
    return publicApi.get<VendorFollowerCountDto>(`/vendors/store/${encodeURIComponent(slug)}/follower-count`, { signal });
  },
};

export const vendorFollowingService = {
  list(signal?: AbortSignal) {
    return userApi.get<FollowedVendorDto[]>("/vendors/follows", { signal });
  },
  async manage(
    params: { search?: string; page?: number; limit?: number },
    signal?: AbortSignal,
  ): Promise<ApiResult<FollowedVendorsPageDto, FollowedVendorsMetaDto>> {
    const response = await userApi.get<
      FollowedVendorDto[] | FollowedVendorsPageDto,
      FollowedVendorsMetaDto
    >("/vendors/follows/manage", { params, signal });
    const data = Array.isArray(response.data) ? response.data : response.data.data;
    const meta = Array.isArray(response.data) ? response.meta : response.data.meta;
    const followingCount = meta?.followingCount ?? data.length;
    const pageNumber = meta?.page ?? params.page ?? 1;
    const limit = meta?.limit ?? params.limit ?? 20;
    const matchingCount = meta?.matchingCount ?? followingCount;

    return {
      ...response,
      data: {
        data,
        meta: {
          followingCount,
          matchingCount,
          page: pageNumber,
          limit,
          totalPages: meta?.totalPages ?? Math.ceil(matchingCount / limit),
        },
      },
    };
  },
  count(signal?: AbortSignal) {
    return userApi.get<{ count: number }>("/vendors/follows/count", { signal });
  },
  follow(vendorId: string) {
    return userApi.post<{ following: boolean; changed: boolean; followerCount: number }>(`/vendors/follows/${encodeURIComponent(vendorId)}`);
  },
  unfollow(vendorId: string) {
    return userApi.delete<{ following: boolean; changed: boolean; followerCount: number }>(`/vendors/follows/${encodeURIComponent(vendorId)}`);
  },
};

export const vendorAccountService = {
  me() {
    return vendorApi.get<VendorResponseDto>("/vendors/me");
  },
  getAccount() {
    return vendorApi.get<VendorResponseDto>("/vendors/account");
  },
  update(payload: Partial<VendorProfileDto>) {
    return vendorApi.patch<VendorResponseDto>("/vendors/account", payload);
  },
  deactivate() {
    return vendorApi.patch<{ success: boolean }>("/vendors/account/deactivate");
  },
  reactivate() {
    return vendorApi.post<{ success: boolean }>("/vendors/account/reactivate");
  },
  deleteAccount() {
    return vendorApi.delete<{ success: boolean }>("/vendors/account");
  },
};

export const adminVendorService = {
  list(params: ProductQueryParams) {
    return adminApi.get<AdminVendorResponseDto[]>("/admin/vendors", { params });
  },
  approve(id: string) {
    return adminApi.patch<AdminVendorResponseDto>(`/admin/vendors/${id}/approve`);
  },
  verify(id: string) {
    return adminApi.patch<AdminVendorResponseDto>(`/admin/vendors/${id}/verify`);
  },
  setActive(id: string, active: boolean) {
    return adminApi.patch<AdminVendorResponseDto>(
      `/admin/vendors/${id}/${active ? "reactivate" : "deactivate"}`
    );
  },
  delete(id: string) {
    return adminApi.delete<void>(`/admin/vendors/${id}`);
  },
};

export const vendorWalletService = {
  get() {
    return vendorApi.get<VendorWalletResponseDto>("/vendors/wallet");
  },
  getWallet() {
    return vendorApi.get<VendorWalletResponseDto>("/vendors/wallet");
  },
  getTransactions(params?: { page?: number; limit?: number }) {
    return vendorApi.get<{
      data: WalletTransactionResponseDto[];
      meta: { total: number; page: number; limit: number; totalPages: number };
    }>("/vendors/wallet/transactions", { params });
  },
};
