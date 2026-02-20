"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { TocItem } from "@/lib/typecho-types";

interface TableOfContentsProps {
  items: TocItem[];
  className?: string;
  onItemClick?: () => void;
}

function itemIndent(level: number) {
  if (level <= 2) {
    return "pl-0";
  }
  if (level === 3) {
    return "pl-[10px]";
  }
  return "pl-5";
}

function itemTextStyle(level: number) {
  return level >= 4 ? "text-[13px]" : "text-sm";
}

export function TableOfContents({ items, className, onItemClick }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState(items[0]?.id ?? "");
  const headingOffset = 0;
  const isProgrammaticScrollingRef = useRef(false);
  const correctionTimerRef = useRef<number | null>(null);
  const unlockTimerRef = useRef<number | null>(null);

  const ids = useMemo(() => items.map((item) => item.id), [items]);

  function clearPendingScrollTimers() {
    if (correctionTimerRef.current !== null) {
      window.clearTimeout(correctionTimerRef.current);
      correctionTimerRef.current = null;
    }
    if (unlockTimerRef.current !== null) {
      window.clearTimeout(unlockTimerRef.current);
      unlockTimerRef.current = null;
    }
  }

  useEffect(() => {
    if (ids.length === 0) {
      return;
    }

    const observed: Element[] = [];
    const observer = new IntersectionObserver(
      (entries) => {
        if (isProgrammaticScrollingRef.current) {
          return;
        }

        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible[0]) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        rootMargin: "-20% 0px -70% 0px",
        threshold: [0, 1],
      },
    );

    ids.forEach((id) => {
      const element = document.getElementById(id);
      if (!element) {
        return;
      }
      observer.observe(element);
      observed.push(element);
    });

    return () => {
      observed.forEach((element) => observer.unobserve(element));
      observer.disconnect();
      clearPendingScrollTimers();
      isProgrammaticScrollingRef.current = false;
    };
  }, [ids]);

  if (items.length === 0) {
    return null;
  }

  function jumpToHeading(id: string) {
    const getScrollRoot = () => document.scrollingElement || document.documentElement;

    const getPageTop = () =>
      window.scrollY ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      0;

    const getMaxPageTop = () => {
      const root = getScrollRoot();
      return Math.max(0, root.scrollHeight - window.innerHeight);
    };

    const setPageTop = (top: number) => {
      const nextTop = Math.min(getMaxPageTop(), Math.max(0, top));
      const root = getScrollRoot();
      root.scrollTop = nextTop;
      document.body.scrollTop = nextTop;
      document.documentElement.scrollTop = nextTop;
    };

    const alignToHeading = (behavior: ScrollBehavior = "auto", force = false) => {
      const target = document.getElementById(id);
      if (!target) {
        return;
      }

      const rawTop = target.getBoundingClientRect().top + getPageTop() - headingOffset;
      const nextTop = Math.min(getMaxPageTop(), Math.max(0, rawTop));
      const currentTop = getPageTop();

      if (!force && Math.abs(nextTop - currentTop) < 10) {
        return;
      }

      if (behavior === "smooth") {
        window.scrollTo({
          top: nextTop,
          behavior: "smooth",
        });
        return;
      }

      setPageTop(nextTop);
    };

    clearPendingScrollTimers();
    isProgrammaticScrollingRef.current = true;
    setActiveId(id);
    window.history.replaceState(null, "", `#${id}`);
    alignToHeading("smooth", true);

    correctionTimerRef.current = window.setTimeout(() => {
      alignToHeading("auto");
    }, 560);

    unlockTimerRef.current = window.setTimeout(() => {
      isProgrammaticScrollingRef.current = false;
    }, 760);
  }

  return (
    <nav className={cn("flex flex-col gap-3", className)} aria-label="目录">
      {items.map((item) => {
        const active = activeId === item.id;
        return (
          <a
            key={item.id}
            href={`#${item.id}`}
            onClick={(event) => {
              event.preventDefault();
              jumpToHeading(item.id);
              onItemClick?.();
            }}
            className={cn(
              "flex items-center gap-2 leading-[1.5] text-muted transition-colors hover:text-primary",
              itemIndent(item.level),
              itemTextStyle(item.level),
              active && "text-primary",
            )}
          >
            {active && item.level <= 2 ? <span className="h-[14px] w-[2px] bg-primary" aria-hidden /> : null}
            <span className="font-sans">{item.text}</span>
          </a>
        );
      })}
    </nav>
  );
}
