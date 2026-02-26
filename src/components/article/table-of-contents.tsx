"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { springScrollToElement } from "@/lib/scroller";
import { TocItem } from "@/lib/typecho-types";

interface TableOfContentsProps {
  items: TocItem[];
  className?: string;
  onItemClick?: () => void;
  scrollInNextTick?: boolean;
}

export function TableOfContents({
  items,
  className,
  onItemClick,
  scrollInNextTick = false,
}: TableOfContentsProps) {
  const [activeId, setActiveId] = useState("");
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const activeLinkRef = useRef<HTMLAnchorElement | null>(null);

  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const rootDepth = useMemo(() => {
    if (items.length === 0) {
      return 2;
    }
    return items.reduce((min, item) => Math.min(min, item.level), items[0]?.level ?? 2);
  }, [items]);

  const resolvedActiveId = useMemo(() => {
    if (activeId && ids.includes(activeId)) {
      return activeId;
    }

    if (typeof window !== "undefined") {
      const hash = decodeURIComponent(window.location.hash.replace(/^#/, "").trim());
      if (hash && ids.includes(hash)) {
        return hash;
      }
    }

    return items[0]?.id ?? "";
  }, [activeId, ids, items]);

  const itemIndent = (level: number) => {
    const depthOffset = Math.max(0, level - rootDepth);
    return `${depthOffset * 0.6 + 0.5}rem`;
  };

  const itemTextStyle = (level: number) => (level >= rootDepth + 2 ? "text-[13px]" : "text-sm");

  useEffect(() => {
    if (ids.length === 0) {
      return;
    }

    const observed: Element[] = [];
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible[0]) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        rootMargin: "-100px 0px -100px 0px",
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
    };
  }, [ids]);

  useEffect(() => {
    const onHashChange = () => {
      const hash = decodeURIComponent(window.location.hash.replace(/^#/, "").trim());
      if (hash && ids.includes(hash)) {
        setActiveId(hash);
      }
    };

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [ids]);

  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.replace(/^#/, "").trim());
    if (!hash) {
      return;
    }

    const target = document.getElementById(hash);
    if (!target) {
      return;
    }

    target.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [ids]);

  useEffect(() => {
    const active = activeLinkRef.current;
    const container = scrollContainerRef.current;
    if (!active || !container) {
      return;
    }

    const itemTop = active.offsetTop;
    const half = container.clientHeight / 2;
    if (itemTop < half) {
      if (container.scrollTop > 0) {
        container.scrollTop = Math.max(0, itemTop - 12);
      }
      return;
    }

    container.scrollTop = itemTop - half;
  }, [resolvedActiveId]);

  const handleScrollTo = useCallback(
    (index: number, element: HTMLElement | null, anchorId: string) => {
      void index;
      onItemClick?.();

      if (!element) {
        return;
      }

      const run = () => {
        window.history.replaceState(window.history.state, "", `#${anchorId}`);
        springScrollToElement(element, -100).then(() => {
          setActiveId(anchorId);
        });
      };

      if (scrollInNextTick) {
        requestAnimationFrame(() => {
          run();
        });
        return;
      }

      run();
    },
    [onItemClick, scrollInNextTick],
  );

  if (items.length === 0) {
    return null;
  }

  return (
    <nav className={cn("flex max-h-[calc(100vh-7rem)] min-h-0 flex-col", className)} aria-label="目录">
      <div ref={scrollContainerRef} className="overflow-auto pr-1 scrollbar-none">
        <ul className="flex flex-col px-2">
          {items.map((item, index) => {
            const active = resolvedActiveId === item.id;
            return (
              <li key={item.id} className="relative leading-none">
                {active ? <span className="mori-toc-active-bar absolute inset-y-[3px] left-0 w-[2px] rounded-sm bg-primary" aria-hidden /> : null}
                <a
                  ref={active ? activeLinkRef : null}
                  href={`#${item.id}`}
                  title={item.text}
                  onClick={(event) => {
                    event.preventDefault();
                    handleScrollTo(index, document.getElementById(item.id), item.id);
                  }}
                  className={cn(
                    "relative mb-[2px] inline-block min-w-0 max-w-full truncate text-left font-sans leading-normal tabular-nums text-secondary opacity-55 transition-all duration-300 hover:opacity-90",
                    itemTextStyle(item.level),
                    active && "mori-toc-active ml-2 text-primary opacity-100",
                  )}
                  style={{
                    paddingLeft: itemIndent(item.level),
                  }}
                  data-index={index}
                  data-depth={item.level}
                >
                  <span className="cursor-pointer">{item.text}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
