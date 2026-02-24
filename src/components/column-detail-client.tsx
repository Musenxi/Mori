"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { ColumnInfoCard } from "@/components/column-info-card";
import { YearPostGroups } from "@/components/year-post-groups";
import { cn } from "@/lib/cn";
import { ColumnInfo } from "@/lib/site-data";
import { YearGroupedPosts } from "@/lib/typecho-types";

interface ColumnDetailClientProps {
  columns: ColumnInfo[];
  initialSlug: string;
  initialColumn: ColumnInfo;
  initialGroups: YearGroupedPosts[];
}

interface ColumnDetailPayload {
  column: ColumnInfo;
  groups: YearGroupedPosts[];
}

const SLOW_LOADING_DELAY_MS = 1400;

export function ColumnDetailClient({
  columns,
  initialSlug,
  initialColumn,
  initialGroups,
}: ColumnDetailClientProps) {
  const [activeSlug, setActiveSlug] = useState(initialSlug);
  const [column, setColumn] = useState(initialColumn);
  const [groups, setGroups] = useState(initialGroups);
  const [animationToken, setAnimationToken] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const cacheRef = useRef<Map<string, ColumnDetailPayload>>(new Map());
  const prefetchingRef = useRef<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    cacheRef.current.set(initialSlug, {
      column: initialColumn,
      groups: initialGroups,
    });
  }, [initialSlug, initialColumn, initialGroups]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const fetchPayload = useCallback(async (slug: string, signal?: AbortSignal) => {
    const response = await fetch(`/api/column-detail?slug=${encodeURIComponent(slug)}`, {
      method: "GET",
      cache: "force-cache",
      signal,
    });

    const result = (await response.json()) as {
      ok: boolean;
      message?: string;
      data?: {
        column: ColumnInfo;
        groups: YearGroupedPosts[];
      };
    };

    if (!response.ok || !result.ok || !result.data) {
      throw new Error(result.message || "专栏数据加载失败。");
    }

    return result.data;
  }, []);

  const prefetch = useCallback(
    async (slug: string) => {
      if (cacheRef.current.has(slug) || prefetchingRef.current.has(slug) || slug === activeSlug) {
        return;
      }

      prefetchingRef.current.add(slug);
      try {
        const data = await fetchPayload(slug);
        cacheRef.current.set(slug, data);
      } catch {
        // Ignore prefetch errors and keep interactive fetch as fallback.
      } finally {
        prefetchingRef.current.delete(slug);
      }
    },
    [activeSlug, fetchPayload],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const topSlugs = columns
        .map((item) => item.slug)
        .filter((slug) => slug !== activeSlug)
        .slice(0, 6);

      topSlugs.forEach((slug) => {
        void prefetch(slug);
      });
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeSlug, columns, prefetch]);

  async function handleSwitch(nextSlug: string) {
    if (!nextSlug || nextSlug === activeSlug) {
      return;
    }

    const prevSlug = activeSlug;
    const cached = cacheRef.current.get(nextSlug);
    setActiveSlug(nextSlug);
    setError("");

    if (cached) {
      setColumn(cached.column);
      setGroups(cached.groups);
      setAnimationToken((value) => value + 1);
      window.history.replaceState(null, "", `/column/${encodeURIComponent(nextSlug)}`);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestIdRef.current;

    const loadingTimer = window.setTimeout(() => {
      setLoading(true);
    }, SLOW_LOADING_DELAY_MS);

    try {
      const data = await fetchPayload(nextSlug, controller.signal);

      if (requestId !== requestIdRef.current) {
        return;
      }

      cacheRef.current.set(nextSlug, data);
      setColumn(data.column);
      setGroups(data.groups);
      setAnimationToken((value) => value + 1);
      window.history.replaceState(null, "", `/column/${encodeURIComponent(nextSlug)}`);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      if (requestId !== requestIdRef.current) {
        return;
      }
      setActiveSlug(prevSlug);
      setError(err instanceof Error ? err.message : "专栏数据加载失败。");
    } finally {
      if (requestId === requestIdRef.current) {
        window.clearTimeout(loadingTimer);
        setLoading(false);
      }
    }
  }

  return (
    <section className="flex flex-col gap-8 md:gap-[60px]">
      <header className="mori-stagger-item flex flex-col gap-8 md:gap-14">
        <div className="flex items-center gap-5 md:gap-8">
          <Link
            href="/column"
            className="font-serif-cn text-[32px] font-bold leading-[1.4] tracking-[4px] text-primary transition-opacity hover:opacity-70 md:text-[36px] md:tracking-[6px]"
          >
            专栏
          </Link>
          <Link
            href="/category"
            className="font-serif-cn text-lg text-muted transition-opacity hover:opacity-70 md:text-xl"
          >
            分类
          </Link>
        </div>

        {columns.length > 1 ? (
          <nav className="flex flex-wrap gap-3" aria-label="专栏切换">
            {columns.map((item) => (
              <button
                key={item.slug}
                type="button"
                onClick={() => void handleSwitch(item.slug)}
                onMouseEnter={() => {
                  void prefetch(item.slug);
                }}
                onFocus={() => {
                  void prefetch(item.slug);
                }}
                className={cn(
                  "inline-flex items-center rounded-full px-4 py-1.5 font-sans text-sm transition-colors",
                  item.slug === activeSlug ? "bg-primary text-bg" : "bg-tag text-secondary hover:bg-hover",
                )}
              >
                {item.name}
              </button>
            ))}
          </nav>
        ) : null}
      </header>

      {error ? <p className="font-sans text-sm leading-8 text-secondary">{error}</p> : null}
      {loading ? <p className="font-sans text-sm leading-8 text-secondary">加载中...</p> : null}

      <div className="mori-stagger-item" style={{ animationDelay: "80ms" }}>
        <ColumnInfoCard column={column} hideAction />
      </div>
      <div className="mori-stagger-item h-px w-full bg-border" style={{ animationDelay: "120ms" }} />

      {groups.length > 0 ? (
        <YearPostGroups groups={groups} staggered animationToken={animationToken} />
      ) : (
        <p className="mori-stagger-item font-sans text-sm leading-8 text-secondary" style={{ animationDelay: "150ms" }}>
          该专栏暂无文章。
        </p>
      )}
    </section>
  );
}
