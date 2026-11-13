"use client";

import { vendorFollowingService } from "@/api/modules/vendor";
import type { FeaturedVendorDto, FollowedVendorDto, FollowedVendorsPageDto } from "@/api/dto/vendor";
import { useAuthStore } from "@/zustand/auth";
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { authBroadcast } from "@/lib/auth-events";

export type FollowableVendor = Pick<
  FeaturedVendorDto,
  "id" | "storeName" | "storeSlug" | "storeDescription" | "storeLogoUrl" | "isVerified"
>;

type FollowVariables = { vendor: FollowableVendor; following: boolean };
type FollowSnapshot = {
  followedVendor: FollowedVendorDto | undefined;
  followedVendorIndex: number;
  cachedFollowPages: Array<[QueryKey, unknown]>;
  count: { count: number } | undefined;
  publicCount: { count: number } | undefined;
};

export function vendorFollowKeys(userId?: string) {
  return {
    list: ["vendor-follows", userId ?? null] as const,
    manage: ["vendor-follows", userId ?? null, "manage"] as const,
    count: ["vendor-follows", userId ?? null, "count"] as const,
  };
}

export function useVendorFollowing() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id);
  const isCustomer = useAuthStore((state) =>
    state.isAuthenticated && (state.capabilities?.canPurchase ?? false),
  );
  const [pendingVendorIds, setPendingVendorIds] = useState<Set<string>>(() => new Set());
  const keys = useMemo(() => vendorFollowKeys(userId), [userId]);
  const followsQuery = useQuery({
    queryKey: keys.list,
    queryFn: async ({ signal }) => (await vendorFollowingService.list(signal)).data,
    enabled: isCustomer,
    staleTime: 60_000,
  });
  const followedIds = new Set((followsQuery.data ?? []).map(({ vendor }) => vendor.id));

  useEffect(() => authBroadcast.subscribe((event) => {
    if (event.type !== "VENDOR_FOLLOW_CHANGED" || event.userId !== userId) return;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.list }),
      queryClient.invalidateQueries({ queryKey: keys.manage }),
      queryClient.invalidateQueries({ queryKey: keys.count }),
      queryClient.invalidateQueries({ queryKey: ["vendor-follower-count", event.vendorSlug] }),
      queryClient.invalidateQueries({ queryKey: ["recommendations", "for-you", userId], refetchType: "all" }),
      queryClient.invalidateQueries({ queryKey: ["recommendations", "following", userId], refetchType: "all" }),
      queryClient.invalidateQueries({ queryKey: ["recommendations", "marketplace-mix"], refetchType: "all" }),
      queryClient.invalidateQueries({ queryKey: ["recommendations", "stores"], refetchType: "all" }),
    ]);
  }), [keys.count, keys.list, keys.manage, queryClient, userId]);

  const mutation = useMutation({
    mutationFn: async ({ vendor, following }: FollowVariables) => {
      if (!userId || !isCustomer) throw new Error("Sign in as a customer to follow stores.");
      return following
        ? (await vendorFollowingService.follow(vendor.id)).data
        : (await vendorFollowingService.unfollow(vendor.id)).data;
    },
    onMutate: async ({ vendor, following }) => {
      setPendingVendorIds((current) => new Set(current).add(vendor.id));
      await queryClient.cancelQueries({ queryKey: keys.list });
      await queryClient.cancelQueries({ queryKey: keys.manage });

      const snapshot: FollowSnapshot = {
        followedVendor: queryClient
          .getQueryData<FollowedVendorDto[]>(keys.list)
          ?.find(({ vendor: currentVendor }) => currentVendor.id === vendor.id),
        followedVendorIndex: queryClient
          .getQueryData<FollowedVendorDto[]>(keys.list)
          ?.findIndex(({ vendor: currentVendor }) => currentVendor.id === vendor.id) ?? -1,
        cachedFollowPages: queryClient.getQueriesData({ queryKey: keys.manage }),
        count: queryClient.getQueryData<{ count: number }>(keys.count),
        publicCount: queryClient.getQueryData<{ count: number }>(["vendor-follower-count", vendor.storeSlug]),
      };
      const delta = following ? 1 : -1;
      queryClient.setQueryData<FollowedVendorDto[]>(keys.list, (current = []) => {
        const alreadyFollowing = current.some(({ vendor: currentVendor }) => currentVendor.id === vendor.id);
        if (following && !alreadyFollowing) {
          return [{ createdAt: new Date(), vendor }, ...current];
        }
        return following
          ? current
          : current.filter(({ vendor: currentVendor }) => currentVendor.id !== vendor.id);
      });
      queryClient.setQueryData<{ count: number }>(keys.count, (current) =>
        current ? { count: Math.max(0, current.count + delta) } : current,
      );
      queryClient.setQueryData<{ count: number }>(["vendor-follower-count", vendor.storeSlug], (current) =>
        current ? { count: Math.max(0, current.count + delta) } : current,
      );

      for (const [queryKey, cached] of snapshot.cachedFollowPages) {
        if (!cached || typeof cached !== "object" || !Array.isArray((cached as FollowedVendorsPageDto).data)) continue;
        const page = cached as FollowedVendorsPageDto;
        const search = String(queryKey[3] ?? "").trim().toLocaleLowerCase();
        const pageNumber = Number(queryKey[4] ?? 1);
        const matchesSearch = !search || vendor.storeName.toLocaleLowerCase().includes(search);
        const wasInPage = page.data.some(({ vendor: currentVendor }) => currentVendor.id === vendor.id);
        let data = page.data;
        if (following && matchesSearch && pageNumber === 1 && !wasInPage) {
          data = [{ createdAt: new Date(), vendor }, ...data].slice(0, page.meta.limit);
        } else if (!following && wasInPage) {
          data = data.filter(({ vendor: currentVendor }) => currentVendor.id !== vendor.id);
        }
        const followingCount = Math.max(0, page.meta.followingCount + delta);
        const matchingCount = Math.max(
          0,
          page.meta.matchingCount + (matchesSearch ? delta : 0),
        );
        queryClient.setQueryData<FollowedVendorsPageDto>(queryKey, {
          data,
          meta: {
            ...page.meta,
            followingCount,
            matchingCount,
            totalPages: Math.ceil(matchingCount / page.meta.limit),
          },
        });
      }

      return snapshot;
    },
    onError: (_error, { vendor, following }, snapshot) => {
      if (!snapshot) return;
      const delta = following ? 1 : -1;
      const currentList = queryClient.getQueryData<FollowedVendorDto[]>(keys.list);
      if (currentList) {
        const nextList = currentList.filter(({ vendor: currentVendor }) => currentVendor.id !== vendor.id);
        if (snapshot.followedVendor) {
          nextList.splice(Math.min(snapshot.followedVendorIndex, nextList.length), 0, snapshot.followedVendor);
        }
        if (!snapshot.followedVendor && nextList.length === 0) {
          queryClient.removeQueries({ queryKey: keys.list, exact: true });
        } else {
          queryClient.setQueryData(keys.list, nextList);
        }
      }
      if (snapshot.count) {
        queryClient.setQueryData<{ count: number }>(keys.count, (current) =>
          current ? { count: Math.max(0, current.count - delta) } : current,
        );
      }
      if (snapshot.publicCount) {
        queryClient.setQueryData<{ count: number }>(["vendor-follower-count", vendor.storeSlug], (current) =>
          current ? { count: Math.max(0, current.count - delta) } : current,
        );
      }
      for (const [queryKey, snapshotPage] of snapshot.cachedFollowPages) {
        if (!snapshotPage || typeof snapshotPage !== "object" || !Array.isArray((snapshotPage as FollowedVendorsPageDto).data)) continue;
        const page = queryClient.getQueryData<FollowedVendorsPageDto>(queryKey);
        if (!page) continue;
        const priorPage = snapshotPage as FollowedVendorsPageDto;
        const search = String(queryKey[3] ?? "").trim().toLocaleLowerCase();
        const matchesSearch = !search || vendor.storeName.toLocaleLowerCase().includes(search);
        const priorIndex = priorPage.data.findIndex(({ vendor: currentVendor }) => currentVendor.id === vendor.id);
        const priorEntry = priorIndex >= 0 ? priorPage.data[priorIndex] : undefined;
        const data = page.data.filter(({ vendor: currentVendor }) => currentVendor.id !== vendor.id);
        if (priorEntry) data.splice(Math.min(priorIndex, data.length), 0, priorEntry);
        const matchingCount = Math.max(0, page.meta.matchingCount - (matchesSearch ? delta : 0));
        queryClient.setQueryData<FollowedVendorsPageDto>(queryKey, {
          data,
          meta: {
            ...page.meta,
            followingCount: Math.max(0, page.meta.followingCount - delta),
            matchingCount,
            totalPages: Math.ceil(matchingCount / page.meta.limit),
          },
        });
      }
    },
    onSuccess: (result, { vendor }) => {
      queryClient.setQueryData<{ count: number }>(["vendor-follower-count", vendor.storeSlug], {
        count: result.followerCount,
      });
      if (result.changed && userId) {
        authBroadcast.publish({
          type: "VENDOR_FOLLOW_CHANGED",
          userId,
          vendorId: vendor.id,
          vendorSlug: vendor.storeSlug,
          following: result.following,
        });
      }
    },
    onSettled: async (_result, _error, { vendor }) => {
      setPendingVendorIds((current) => {
        const next = new Set(current);
        next.delete(vendor.id);
        return next;
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.list }),
        queryClient.invalidateQueries({ queryKey: keys.manage }),
        queryClient.invalidateQueries({ queryKey: keys.count }),
        queryClient.invalidateQueries({ queryKey: ["vendor-follower-count", vendor.storeSlug] }),
        queryClient.invalidateQueries({ queryKey: ["recommendations", "for-you", userId], refetchType: "all" }),
        queryClient.invalidateQueries({ queryKey: ["recommendations", "following", userId], refetchType: "all" }),
        queryClient.invalidateQueries({ queryKey: ["recommendations", "marketplace-mix"], refetchType: "all" }),
        queryClient.invalidateQueries({ queryKey: ["recommendations", "stores"], refetchType: "all" }),
      ]);
    },
  });

  return {
    followedIds,
    isLoading: followsQuery.isLoading,
    isFollowing: (vendorId: string) => followedIds.has(vendorId),
    isPending: (vendorId: string) => pendingVendorIds.has(vendorId),
    setFollowing: (vendor: FollowableVendor, following: boolean) =>
      mutation.mutateAsync({ vendor, following }),
  };
}
