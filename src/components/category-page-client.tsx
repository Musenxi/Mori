"use client";

import Link from "next/link";
import { useState } from "react";

import { CategoryFilter } from "@/components/category-filter";
import { YearPostGroups } from "@/components/year-post-groups";
import { ColumnInfo } from "@/lib/site-data";
import { YearGroupedPosts } from "@/lib/typecho-types";

interface CategoryPageClientProps {
  initialCategories: ColumnInfo[];
  initialGroups: YearGroupedPosts[];
  initialActiveSlug: string | null;
}

export function CategoryPageClient({
  initialCategories,
  initialGroups,
  initialActiveSlug,
}: CategoryPageClientProps) {
  const [categories, setCategories] = useState(initialCategories);
  const [groups, setGroups] = useState(initialGroups);
  const [activeSlug, setActiveSlug] = useState<string | null>(initialActiveSlug);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSelect(nextSlug: string | null) {
    if (loading || nextSlug === activeSlug) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const query = nextSlug ? `?slug=${encodeURIComponent(nextSlug)}&_t=${Date.now()}` : `?_t=${Date.now()}`;
      const response = await fetch(`/api/category-data${query}`, {
        method: "GET",
        cache: "no-store",
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

      setActiveSlug(nextSlug);
      setCategories(result.data.categories);
      setGroups(result.data.groups);

      const nextUrl = nextSlug ? `/category?slug=${encodeURIComponent(nextSlug)}` : "/category";
      window.history.replaceState(null, "", nextUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "分类数据加载失败。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <header className="flex flex-col gap-8 md:gap-14">
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
          disabled={loading}
        />
      </header>

      {error ? <p className="font-sans text-sm leading-8 text-secondary">{error}</p> : null}
      {loading ? <p className="font-sans text-sm leading-8 text-secondary">加载中...</p> : null}

      {!loading ? (
        groups.length > 0 ? (
          <YearPostGroups groups={groups} />
        ) : (
          <p className="font-sans text-sm leading-8 text-secondary">该分类暂无文章。</p>
        )
      ) : null}
    </>
  );
}
