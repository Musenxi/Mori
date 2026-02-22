"use client";

function getCurrentScrollTop() {
  return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
}

function setCurrentScrollTop(top: number) {
  const next = Math.max(0, top);
  window.scrollTo(0, next);
  document.documentElement.scrollTop = next;
  document.body.scrollTop = next;
}

function getMaxScrollTop() {
  const root = document.scrollingElement || document.documentElement;
  return Math.max(0, root.scrollHeight - window.innerHeight);
}

export function springScrollTo(y: number, duration = 420) {
  return new Promise<void>((resolve) => {
    const from = getCurrentScrollTop();
    const to = Math.min(getMaxScrollTop(), Math.max(0, y));
    if (Math.abs(to - from) < 1) {
      setCurrentScrollTop(to);
      resolve();
      return;
    }

    let rafId = 0;
    let stopped = false;
    const startedAt = performance.now();

    const cleanup = () => {
      window.removeEventListener("wheel", stopByUser);
      window.removeEventListener("touchmove", stopByUser);
      if (rafId) {
        window.cancelAnimationFrame(rafId);
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

    const easeOutCubic = (progress: number) => 1 - Math.pow(1 - progress, 3);

    const tick = (now: number) => {
      if (stopped) {
        return;
      }

      const elapsed = now - startedAt;
      const progress = Math.min(1, elapsed / duration);
      const eased = easeOutCubic(progress);
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

    rafId = window.requestAnimationFrame(tick);
  });
}

export function springScrollToTop() {
  return springScrollTo(0);
}

function calculateElementTop(element: HTMLElement) {
  let top = 0;
  let current: HTMLElement | null = element;
  while (current) {
    top += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }
  return top;
}

export function springScrollToElement(element: HTMLElement, delta = 40) {
  return springScrollTo(calculateElementTop(element) + delta);
}
