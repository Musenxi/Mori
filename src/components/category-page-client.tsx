"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { CategoryFilter } from "@/components/category-filter";
import { YearPostGroups } from "@/components/year-post-groups";
import { ColumnInfo } from "@/lib/site-data";
import { YearGroupedPosts } from "@/lib/typecho-types";

interface CategoryPageClientProps {
  initialCategories: ColumnInfo[];
  initialGroups: YearGroupedPosts[];
  initialActiveSlug: string | null;
}

interface CategoryDataPayload {
  categories: ColumnInfo[];
  groups: YearGroupedPosts[];
}

const ALL_KEY = "__all__";
const SLOW_LOADING_DELAY_MS = 1400;

function toCacheKey(slug: string | null) {
  return slug ?? ALL_KEY;
}

export function CategoryPageClient({
  initialCategories,
  initialGroups,
  initialActiveSlug,
}: CategoryPageClientProps) {
  const [categories, setCategories] = useState(initialCategories);
  const [groups, setGroups] = useState(initialGroups);
  const [activeSlug, setActiveSlug] = useState<string | null>(initialActiveSlug);
  const [animationToken, setAnimationToken] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const cacheRef = useRef<Map<string, CategoryDataPayload>>(new Map());
  const prefetchingRef = useRef<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    cacheRef.current.set(toCacheKey(initialActiveSlug), {
      categories: initialCategories,
      groups: initialGroups,
    });
  }, [initialActiveSlug, initialCategories, initialGroups]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const fetchPayload = useCallback(async (slug: string | null, signal?: AbortSignal) => {
    const query = slug ? `?slug=${encodeURIComponent(slug)}` : "";
    const response = await fetch(`/api/category-data${query}`, {
      method: "GET",
      cache: "force-cache",
      signal,
    });

    const result = (await response.json()) as {
      ok: boolean;
      message?: string;
      data?: {
        categories: ColumnInfo[];
        groups: YearGroupedPosts[];
      };
    };

    if (!response.ok || !result.ok || !result.data) {
      throw new Error(result.message || "分类数据加载失败。");
    }

    return result.data;
  }, []);

  const prefetch = useCallback(
    async (slug: string | null) => {
      const cacheKey = toCacheKey(slug);
      if (cacheRef.current.has(cacheKey) || prefetchingRef.current.has(cacheKey)) {
        return;
      }

      prefetchingRef.current.add(cacheKey);
      try {
        const data = await fetchPayload(slug);
        cacheRef.current.set(cacheKey, data);
      } catch {
        // Ignore prefetch errors and keep interactive fetch as fallback.
      } finally {
        prefetchingRef.current.delete(cacheKey);
      }
    },
    [fetchPayload],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const topSlugs = categories
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
  }, [activeSlug, categories, prefetch]);

  async function handleSelect(nextSlug: string | null) {
    if (nextSlug === activeSlug) {
      return;
    }

    const prevSlug = activeSlug;
    const cacheKey = toCacheKey(nextSlug);
    const cached = cacheRef.current.get(cacheKey);
    setActiveSlug(nextSlug);
    setError("");

    if (cached) {
      setCategories(cached.categories);
      setGroups(cached.groups);
      setAnimationToken((value) => value + 1);
      const nextUrl = nextSlug ? `/category?slug=${encodeURIComponent(nextSlug)}` : "/category";
      window.history.replaceState(null, "", nextUrl);
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

      cacheRef.current.set(cacheKey, data);
      setCategories(data.categories);
      setGroups(data.groups);
      setAnimationToken((value) => value + 1);

      const nextUrl = nextSlug ? `/category?slug=${encodeURIComponent(nextSlug)}` : "/category";
      window.history.replaceState(null, "", nextUrl);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      if (requestId !== requestIdRef.current) {
        return;
      }
      setActiveSlug(prevSlug);
      setError(err instanceof Error ? err.message : "分类数据加载失败。");
    } finally {
      if (requestId === requestIdRef.current) {
        window.clearTimeout(loadingTimer);
        setLoading(false);
      }
    }
  }

  return (
    <>
      <header className="mori-stagger-item flex flex-col gap-8 md:gap-14">
        <div className="flex items-center gap-5 md:gap-8">
          <h1 className="font-serif-cn text-[32px] font-bold leading-[1.4] tracking-[4px] text-primary md:text-[36px] md:tracking-[6px]">
            分类
          </h1>
          <Link
            href="/column"
            className="font-serif-cn text-lg text-muted transition-opacity hover:opacity-70 md:text-xl"
          >
            专栏
          </Link>
        </div>

        <CategoryFilter
          categories={categories}
          activeSlug={activeSlug}
          onSelect={handleSelect}
          onPrefetch={(slug) => {
            void prefetch(slug);
          }}
        />
      </header>

      {error ? (
        <p className="mori-stagger-item font-sans text-sm leading-8 text-secondary" style={{ animationDelay: "80ms" }}>
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className="mori-stagger-item font-sans text-sm leading-8 text-secondary" style={{ animationDelay: "80ms" }}>
          加载中...
        </p>
      ) : null}

      {groups.length > 0 ? (
        <YearPostGroups groups={groups} staggered animationToken={animationToken} />
      ) : (
        <p className="mori-stagger-item font-sans text-sm leading-8 text-secondary" style={{ animationDelay: "110ms" }}>
          该分类暂无文章。
        </p>
      )}
    </>
  );
}
