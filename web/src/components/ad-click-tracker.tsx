"use client";

import { useEffect } from "react";

const COOKIE = "_twclid";

/**
 * Captures the X ads click id (?twclid=...) from the landing URL into a
 * first-party cookie so the signup flow can attribute the conversion
 * server-side. Renders nothing; no-ops when the param is absent.
 */
export function AdClickTracker() {
  useEffect(() => {
    const twclid = new URLSearchParams(window.location.search).get("twclid");
    if (!twclid) return;
    const maxAge = 30 * 24 * 60 * 60; // 30 days
    document.cookie = `${COOKIE}=${encodeURIComponent(twclid)}; path=/; max-age=${maxAge}; SameSite=Lax`;
  }, []);
  return null;
}

/** Read the captured click id (empty string when absent). */
export function readAdClickId(): string {
  const match = document.cookie.match(/(?:^|;\s*)_twclid=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}
