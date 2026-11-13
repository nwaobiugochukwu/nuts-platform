"use client";

import { useSyncExternalStore } from "react";
import {
  getRecommendationSessionSnapshot,
  getRecommendationVisitorSnapshot,
  subscribeRecommendationIdentity,
} from "@/lib/recommendation-session";

const getServerIdentitySnapshot = () => "";

export function useRecommendationSessionId(): string {
  return useSyncExternalStore(
    subscribeRecommendationIdentity,
    getRecommendationSessionSnapshot,
    getServerIdentitySnapshot,
  );
}

export function useRecommendationVisitorId(): string {
  return useSyncExternalStore(
    subscribeRecommendationIdentity,
    getRecommendationVisitorSnapshot,
    getServerIdentitySnapshot,
  );
}
