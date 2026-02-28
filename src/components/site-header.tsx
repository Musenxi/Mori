"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { usePathname } from "next/navigation";

import { SiteHeaderStatusDesktop, SiteHeaderStatusMobile } from "@/components/site-header-status";
import { cn } from "@/lib/cn";

export interface NavItem {
  href: string;
  label: string;
}

interface SiteHeaderProps {
  blogTitle: string;
  navItems: NavItem[];
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <span className="relative flex h-6 w-6 items-center justify-center" aria-hidden>
      <span
        className={cn(
          "absolute h-[2px] w-5 rounded-full bg-primary transition-all duration-200",
          open ? "rotate-45" : "-translate-y-[6px]",
        )}
      />
      <span
        className={cn(
          "absolute h-[2px] w-5 rounded-full bg-primary transition-all duration-200",
          open ? "opacity-0" : "opacity-100",
        )}
      />
      <span
        className={cn(
          "absolute h-[2px] w-5 rounded-full bg-primary transition-all duration-200",
          open ? "-rotate-45" : "translate-y-[6px]",
        )}
      />
    </span>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const clearClassTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(false);

  useEffect(
    () => () => {
      if (clearClassTimerRef.current != null) {
        window.clearTimeout(clearClassTimerRef.current);
      }
    },
    [],
  );

  const triggerGlobalThemeTransition = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      return;
    }

    const root = document.documentElement;
    root.classList.add("mori-theme-switching");

    if (clearClassTimerRef.current != null) {
      window.clearTimeout(clearClassTimerRef.current);
    }

    clearClassTimerRef.current = window.setTimeout(() => {
      root.classList.remove("mori-theme-switching");
      clearClassTimerRef.current = null;
    }, 420);
  }, []);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }

    triggerGlobalThemeTransition();
  }, [resolvedTheme, triggerGlobalThemeTransition]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => {
      setTheme("system");
    };

    media.addEventListener("change", handleSystemThemeChange);
    return () => {
      media.removeEventListener("change", handleSystemThemeChange);
    };
  }, [setTheme]);

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label="切换主题（系统变化自动同步）"
      title="切换主题（系统变化自动同步）"
      className="font-sans text-[18px] leading-none text-primary transition-opacity hover:opacity-70"
      onClick={() => {
        setTheme(isDark ? "light" : "dark");
      }}
    >
      ◑
    </button>
  );
}

export function SiteHeader({ blogTitle, navItems }: SiteHeaderProps) {
  const pathname = usePathname();
  const mobileArticleMode = pathname.startsWith("/post/");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileHeaderVisible, setMobileHeaderVisible] = useState(true);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen || typeof window === "undefined") {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      setMobileHeaderVisible(true);
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [mobileOpen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (mobileOpen) {
      return;
    }

    let lastY = window.scrollY;
    let rafId = 0;

    const onScroll = () => {
      if (rafId) {
        return;
      }

      rafId = window.requestAnimationFrame(() => {
        const currentY = window.scrollY;
        const delta = currentY - lastY;

        if (currentY <= 24) {
          setMobileHeaderVisible(true);
        } else if (delta > 6) {
          setMobileHeaderVisible(false);
        } else if (delta < -6) {
          setMobileHeaderVisible(true);
        }

        lastY = currentY;
        rafId = 0;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [mobileOpen]);

  const navNode = useMemo(
    () =>
      navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="font-serif-cn text-[17px] tracking-[2px] text-primary transition-opacity hover:opacity-70 md:text-[17px]"
          onClick={() => setMobileOpen(false)}
        >
          {item.label}
        </Link>
      )),
    [navItems],
  );

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-30 hidden w-full items-center justify-between bg-transparent px-[60px] py-6 transition-transform duration-200 min-[1080px]:flex",
          mobileHeaderVisible ? "translate-y-0" : "-translate-y-full"
        )}
      >
        <div className="flex items-center gap-3">
          <Link href="/" className="font-serif-cn text-[22px] tracking-[4px] text-primary transition-opacity hover:opacity-70">
            {blogTitle}
          </Link>
          <SiteHeaderStatusDesktop />
        </div>

        <div className="flex items-center gap-12">
          <nav className="flex items-center gap-8">{navNode}</nav>
          <ThemeToggle />
        </div>
      </header>

      <header
        className={cn(
          "sticky top-0 z-30 w-full bg-transparent px-5 py-6 transition-transform duration-200 min-[1080px]:hidden",
          mobileHeaderVisible || mobileOpen ? "translate-y-0" : "-translate-y-full",
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <Link href="/" className="font-serif-cn text-[22px] tracking-[4px] text-primary transition-opacity hover:opacity-70">
              {blogTitle}
            </Link>
            <SiteHeaderStatusMobile />
          </div>

          <div className="flex items-center gap-4">
            {mobileArticleMode ? (
              <>
                <button
                  type="button"
                  className="font-serif-cn text-[13px] tracking-[1px] text-secondary"
                  onClick={() => window.dispatchEvent(new Event("mori:open-toc"))}
                >
                  展开目录
                </button>
                <span className="h-4 w-px bg-border" aria-hidden />
              </>
            ) : null}

            <button
              type="button"
              aria-label={mobileOpen ? "关闭菜单" : "打开菜单"}
              className="text-primary"
              onClick={() => setMobileOpen((prev) => !prev)}
            >
              <MenuIcon open={mobileOpen} />
            </button>
          </div>
        </div>
      </header>

      <div
        className={cn(
          "fixed inset-0 z-40 bg-bg transition-opacity duration-200 min-[1080px]:hidden",
          mobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <div className="px-5 py-6">
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="font-serif-cn text-[22px] tracking-[4px] text-primary"
              onClick={() => setMobileOpen(false)}
            >
              {blogTitle}
            </Link>

            <button
              type="button"
              aria-label="关闭菜单"
              className="text-primary"
              onClick={() => setMobileOpen(false)}
            >
              <MenuIcon open />
            </button>
          </div>
        </div>

        <nav className="flex h-[calc(100vh-96px)] flex-col items-center justify-center gap-10 px-5">
          {navItems.map((item) => (
            <Link
              key={`mobile-${item.href}`}
              href={item.href}
              className="font-serif-cn text-2xl tracking-[2px] text-primary"
              onClick={() => setMobileOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </>
  );
}
