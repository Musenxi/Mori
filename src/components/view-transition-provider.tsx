"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { springScrollToTop } from "@/lib/scroller";

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
  const pendingSmoothTopRef = useRef(false);
  const layoutLockTimerRef = useRef<number | null>(null);
  const footerRevealTimerRef = useRef<number | null>(null);

  const clearFooterDeferredState = useCallback(() => {
    if (footerRevealTimerRef.current != null) {
      window.clearTimeout(footerRevealTimerRef.current);
      footerRevealTimerRef.current = null;
    }

    document.documentElement.classList.remove("mori-footer-deferred");
  }, []);

  const clearPostToPostSwitchState = useCallback(() => {
    document.documentElement.classList.remove("mori-post-to-post-switch");
  }, []);

  const markPostToPostSwitch = useCallback(() => {
    document.documentElement.classList.add("mori-post-to-post-switch");
  }, []);

  const hideFooterForRouteSwitch = useCallback(() => {
    if (footerRevealTimerRef.current != null) {
      window.clearTimeout(footerRevealTimerRef.current);
      footerRevealTimerRef.current = null;
    }

    document.documentElement.classList.add("mori-footer-deferred");
  }, []);

  const scheduleFooterReveal = useCallback(
    (delayMs: number) => {
      if (footerRevealTimerRef.current != null) {
        window.clearTimeout(footerRevealTimerRef.current);
      }

      footerRevealTimerRef.current = window.setTimeout(() => {
        document.documentElement.classList.remove("mori-footer-deferred");
        footerRevealTimerRef.current = null;
      }, delayMs);
    },
    [],
  );

  const clearRouteLayoutLock = useCallback(() => {
    if (layoutLockTimerRef.current != null) {
      window.clearTimeout(layoutLockTimerRef.current);
      layoutLockTimerRef.current = null;
    }

    document.documentElement.classList.remove("mori-route-switching");
    document.documentElement.style.removeProperty("--mori-route-lock-height");
  }, []);

  const scheduleRouteLayoutLockRelease = useCallback(
    (delayMs: number) => {
      if (layoutLockTimerRef.current != null) {
        window.clearTimeout(layoutLockTimerRef.current);
      }

      layoutLockTimerRef.current = window.setTimeout(() => {
        clearRouteLayoutLock();
      }, delayMs);
    },
    [clearRouteLayoutLock],
  );

  const lockCurrentRouteLayoutHeight = useCallback(() => {
    const transitionRegion = document.querySelector<HTMLElement>(".mori-view-transition-region");
    if (!transitionRegion) {
      return;
    }

    const regionHeight = Math.ceil(transitionRegion.getBoundingClientRect().height);
    if (!Number.isFinite(regionHeight) || regionHeight <= 0) {
      return;
    }

    document.documentElement.style.setProperty("--mori-route-lock-height", `${regionHeight}px`);
    document.documentElement.classList.add("mori-route-switching");
    hideFooterForRouteSwitch();
    scheduleRouteLayoutLockRelease(5200);
    scheduleFooterReveal(5400);
  }, [hideFooterForRouteSwitch, scheduleFooterReveal, scheduleRouteLayoutLockRelease]);

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
    scheduleRouteLayoutLockRelease(260);
    scheduleFooterReveal(360);
    if (pendingSmoothTopRef.current) {
      pendingSmoothTopRef.current = false;
      void springScrollToTop({ duration: 680, preferNativeSmooth: false });
    }
  }, [pathname, searchParams, completePendingNavigation, scheduleFooterReveal, scheduleRouteLayoutLockRelease]);

  useEffect(
    () => () => {
      completePendingNavigation();
      clearRouteLayoutLock();
      clearFooterDeferredState();
      clearPostToPostSwitchState();
    },
    [clearFooterDeferredState, clearPostToPostSwitchState, clearRouteLayoutLock, completePendingNavigation],
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
      const isPostToPost =
        window.location.pathname.startsWith("/post/")
        && nextUrl.pathname.startsWith("/post/")
        && nextUrl.pathname !== window.location.pathname;
      if (isPostToPost) {
        markPostToPostSwitch();
      } else {
        clearPostToPostSwitchState();
      }

      if (!doc.startViewTransition || reducedMotion) {
        lockCurrentRouteLayoutHeight();
        pendingSmoothTopRef.current = isPostToPost;
        router.push(nextHref, { scroll: !isPostToPost });
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
              }, 4500);
              lockCurrentRouteLayoutHeight();
              pendingSmoothTopRef.current = isPostToPost;
              router.push(nextHref, { scroll: !isPostToPost });
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
  }, [router, clearPostToPostSwitchState, completePendingNavigation, lockCurrentRouteLayoutHeight, markPostToPostSwitch]);

  return null;
}
