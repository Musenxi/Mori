"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { CategoryFilter } from "@/components/category-filter";
import { YearPostGroups } from "@/components/year-post-groups";
import { ColumnInfo } from "@/lib/site-data";
import { NormalizedPost, YearGroupedPosts } from "@/lib/typecho-types";

interface CategoryPageClientProps {
  initialCategories: ColumnInfo[];
  initialGroups: YearGroupedPosts[];
  initialActiveSlug: string | null;
  posts: NormalizedPost[];
}

function normalizeCategorySlug(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function filterPostsBySlug(posts: NormalizedPost[], slug: string | null) {
  const normalized = normalizeCategorySlug(slug);
  if (!normalized) {
    return posts;
  }
  return posts.filter(
    (post) => normalizeCategorySlug(post.categorySlug) === normalized,
  );
}

function groupPostsByYear(posts: NormalizedPost[]): YearGroupedPosts[] {
  const map = new Map<string, NormalizedPost[]>();

  posts.forEach((post) => {
    const year = `${new Date(post.created * 1000).getFullYear()}`;
    const current = map.get(year) ?? [];
    current.push(post);
    map.set(year, current);
  });

  return [...map.entries()]
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([year, yearPosts]) => ({
      year,
      posts: yearPosts.sort((a, b) => b.created - a.created),
    }));
}

export function CategoryPageClient({
  initialCategories,
  initialGroups,
  initialActiveSlug,
  posts,
}: CategoryPageClientProps) {
  const searchParams = useSearchParams();
  const [animationToken, setAnimationToken] = useState(0);
  const activeSlug = searchParams.get("slug")?.trim() || initialActiveSlug;
  const groups = useMemo(() => {
    if (!activeSlug || activeSlug === initialActiveSlug) {
      return initialGroups;
    }

    return groupPostsByYear(filterPostsBySlug(posts, activeSlug));
  }, [activeSlug, initialActiveSlug, initialGroups, posts]);

  function handleSelect(nextSlug: string | null) {
    if (nextSlug === activeSlug) {
      return;
    }

    setAnimationToken((value) => value + 1);
    const nextUrl = nextSlug ? `/category?slug=${encodeURIComponent(nextSlug)}` : "/category";
    window.history.replaceState(null, "", nextUrl);
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
          categories={initialCategories}
          activeSlug={activeSlug}
          onSelect={handleSelect}
          onPrefetch={() => {}}
        />
      </header>

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
