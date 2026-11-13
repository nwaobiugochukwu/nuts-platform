"use client";

import {
  analyticsEventService,
  type RecommendationAttribution,
} from "@/api/modules/analytics";
import { useEffect, useRef, type RefObject } from "react";

type RecommendationItem = {
  productId?: string;
  vendorId?: string;
  categoryId?: string;
};

const MINIMUM_VISIBLE_RATIO = 0.5;
const IMPRESSION_DWELL_TIME_MS = 1_000;

export function useRecommendationImpression({
  elementRef,
  attribution,
  item,
  authenticated,
}: {
  elementRef: RefObject<HTMLElement | null>;
  attribution?: RecommendationAttribution;
  item: RecommendationItem;
  authenticated: boolean;
}) {
  const trackedKeyRef = useRef("");
  const requestId = attribution?.requestId;
  const surface = attribution?.surface;
  const rankerVersion = attribution?.rankerVersion;
  const position = attribution?.position;
  const sessionId = attribution?.sessionId;
  const productId = item.productId;
  const vendorId = item.vendorId;
  const categoryId = item.categoryId;
  const entity = productId
    ? `product:${productId}`
    : vendorId
      ? `vendor:${vendorId}`
      : categoryId
        ? `category:${categoryId}`
        : "";
  const trackedKey = requestId && surface && entity
    ? `${surface}:${requestId}:${entity}`
    : "";

  useEffect(() => {
    const element = elementRef.current;
    if (
      !element ||
      !requestId ||
      !surface ||
      !rankerVersion ||
      position === undefined ||
      !sessionId ||
      !trackedKey ||
      trackedKeyRef.current === trackedKey
    ) return;

    let dwellTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      const isViewable = Boolean(
        entry?.isIntersecting && entry.intersectionRatio >= MINIMUM_VISIBLE_RATIO,
      );

      if (!isViewable) {
        if (dwellTimer) clearTimeout(dwellTimer);
        dwellTimer = undefined;
        return;
      }

      if (dwellTimer || trackedKeyRef.current === trackedKey) return;
      dwellTimer = setTimeout(() => {
        dwellTimer = undefined;
        trackedKeyRef.current = trackedKey;
        void analyticsEventService.trackRecommendation(
          { requestId, surface, rankerVersion, position, sessionId },
          "IMPRESSION",
          { ...(productId ? { productId } : {}), ...(vendorId ? { vendorId } : {}), ...(categoryId ? { categoryId } : {}) },
          authenticated,
        ).catch(() => undefined);
        observer.disconnect();
      }, IMPRESSION_DWELL_TIME_MS);
    }, { threshold: [0, MINIMUM_VISIBLE_RATIO] });

    observer.observe(element);
    return () => {
      if (dwellTimer) clearTimeout(dwellTimer);
      observer.disconnect();
    };
  }, [
    authenticated,
    categoryId,
    elementRef,
    position,
    productId,
    rankerVersion,
    requestId,
    sessionId,
    surface,
    trackedKey,
    vendorId,
  ]);
}
