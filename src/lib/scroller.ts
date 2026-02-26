"use client";

let cancelActiveSpringScroll: (() => void) | null = null;

function getCurrentScrollTop() {
  return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
}

function setCurrentScrollTop(top: number) {
  const next = Math.max(0, top);
  window.scrollTo(0, next);
}

function getMaxScrollTop() {
  const root = document.scrollingElement || document.documentElement;
  return Math.max(0, root.scrollHeight - window.innerHeight);
}

function supportsNativeSmoothScroll() {
  return "scrollBehavior" in document.documentElement.style;
}

function settleWithNativeSmoothScroll(to: number) {
  return new Promise<void>((resolve) => {
    let rafId = 0;
    let stopped = false;
    let settledFrames = 0;

    const cleanup = () => {
      window.removeEventListener("wheel", stopByUser);
      window.removeEventListener("touchmove", stopByUser);
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      if (cancelActiveSpringScroll === stopByUser) {
        cancelActiveSpringScroll = null;
      }
    };

    const finish = (snapToTarget: boolean) => {
      if (stopped) {
        return;
      }
      stopped = true;
      if (snapToTarget) {
        setCurrentScrollTop(to);
      }
      cleanup();
      resolve();
    };

    const stopByUser = () => {
      finish(false);
    };

    const tick = () => {
      if (stopped) {
        return;
      }

      const diff = Math.abs(getCurrentScrollTop() - to);
      if (diff <= 1) {
        settledFrames += 1;
        if (settledFrames >= 2) {
          finish(true);
          return;
        }
      } else {
        settledFrames = 0;
      }

      rafId = window.requestAnimationFrame(tick);
    };

    window.addEventListener("wheel", stopByUser, { passive: true });
    window.addEventListener("touchmove", stopByUser, { passive: true });
    cancelActiveSpringScroll = stopByUser;

    window.scrollTo({ top: to, left: 0, behavior: "smooth" });
    rafId = window.requestAnimationFrame(tick);
  });
}

export function springScrollTo(y: number, duration = 420) {
  cancelActiveSpringScroll?.();

  const from = getCurrentScrollTop();
  const to = Math.min(getMaxScrollTop(), Math.max(0, y));
  if (Math.abs(to - from) < 1) {
    setCurrentScrollTop(to);
    return Promise.resolve();
  }

  if (supportsNativeSmoothScroll()) {
    return settleWithNativeSmoothScroll(to);
  }

  return new Promise<void>((resolve) => {
    let rafId = 0;
    let stopped = false;
    const startedAt = performance.now();

    const cleanup = () => {
      window.removeEventListener("wheel", stopByUser);
      window.removeEventListener("touchmove", stopByUser);
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      if (cancelActiveSpringScroll === stopByUser) {
        cancelActiveSpringScroll = null;
      }
    };

    const stopByUser = () => {
      if (stopped) {
        return;
      }
      stopped = true;
      cleanup();
      resolve();
    };

    const easeInOutCubic = (progress: number) => (
      progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2
    );

    const tick = (now: number) => {
      if (stopped) {
        return;
      }

      const elapsed = now - startedAt;
      const progress = Math.min(1, elapsed / duration);
      const eased = easeInOutCubic(progress);
      setCurrentScrollTop(from + (to - from) * eased);

      if (progress >= 1) {
        stopped = true;
        cleanup();
        resolve();
        return;
      }

      rafId = window.requestAnimationFrame(tick);
    };

    window.addEventListener("wheel", stopByUser, { passive: true });
    window.addEventListener("touchmove", stopByUser, { passive: true });
    cancelActiveSpringScroll = stopByUser;

    rafId = window.requestAnimationFrame(tick);
  });
}

export function springScrollToTop() {
  return springScrollTo(0);
}

function calculateElementTop(element: HTMLElement) {
  return window.scrollY + element.getBoundingClientRect().top;
}

export function springScrollToElement(element: HTMLElement, delta = 40) {
  return springScrollTo(calculateElementTop(element) + delta);
}
