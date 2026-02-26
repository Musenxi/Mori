"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

type ViewTransitionDocument = Document & {
  startViewTransition?: (updateCallback: () => void | Promise<void>) => {
    finished: Promise<void>;
  };
};

function isModifiedEvent(event: MouseEvent) {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

export function ViewTransitionProvider() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pendingResolveRef = useRef<(() => void) | null>(null);
  const pendingTimerRef = useRef<number | null>(null);

  const completePendingNavigation = useCallback(() => {
    if (pendingTimerRef.current != null) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    if (pendingResolveRef.current) {
      pendingResolveRef.current();
      pendingResolveRef.current = null;
    }
  }, []);

  useEffect(() => {
    completePendingNavigation();
  }, [pathname, searchParams, completePendingNavigation]);

  useEffect(
    () => () => {
      completePendingNavigation();
    },
    [completePendingNavigation],
  );

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || isModifiedEvent(event)) {
        return;
      }

      const target = event.target as Element | null;
      if (!target) {
        return;
      }

      const anchor = target.closest("a");
      if (!anchor) {
        return;
      }

      if (anchor.getAttribute("target") && anchor.getAttribute("target") !== "_self") {
        return;
      }
      if (anchor.hasAttribute("download") || anchor.getAttribute("rel")?.includes("external")) {
        return;
      }
      if (anchor.dataset.noViewTransition === "true") {
        return;
      }

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) {
        return;
      }

      let nextUrl: URL;
      try {
        nextUrl = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      if (nextUrl.origin !== window.location.origin) {
        return;
      }

      const isSamePath = nextUrl.pathname === window.location.pathname;
      const isSameSearch = nextUrl.search === window.location.search;
      const isSameHash = nextUrl.hash === window.location.hash;
      const hashOnlyJump = isSamePath && isSameSearch && nextUrl.hash.length > 0;

      if (hashOnlyJump || (isSamePath && isSameSearch && isSameHash)) {
        return;
      }

      event.preventDefault();

      const nextHref = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
      const doc = document as ViewTransitionDocument;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (!doc.startViewTransition || reducedMotion) {
        router.push(nextHref);
        return;
      }

      void doc
        .startViewTransition(
          () =>
            new Promise<void>((resolve) => {
              completePendingNavigation();
              pendingResolveRef.current = resolve;
              pendingTimerRef.current = window.setTimeout(() => {
                completePendingNavigation();
              }, 1800);
              router.push(nextHref);
            }),
        )
        .finished.catch(() => {
          completePendingNavigation();
        });
    };

    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
    };
  }, [router, completePendingNavigation]);

  return null;
}
