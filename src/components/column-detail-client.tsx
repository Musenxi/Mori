"use client";

import Link from "next/link";
import { useState } from "react";

import { ColumnInfoCard } from "@/components/column-info-card";
import { YearPostGroups } from "@/components/year-post-groups";
import { cn } from "@/lib/cn";
import { ColumnInfo } from "@/lib/site-data";
import { NormalizedPost, YearGroupedPosts } from "@/lib/typecho-types";

interface ColumnDetailClientProps {
  columns: ColumnInfo[];
  initialSlug: string;
  initialColumn: ColumnInfo;
  initialGroups: YearGroupedPosts[];
  posts: NormalizedPost[];
}

function normalizeColumnSlug(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function filterPostsBySlug(posts: NormalizedPost[], slug: string) {
  const normalized = normalizeColumnSlug(slug);
  if (!normalized) {
    return [] as NormalizedPost[];
  }
  return posts.filter((post) => normalizeColumnSlug(post.seriesSlug) === normalized);
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

function resolveColumn(columns: ColumnInfo[], slug: string) {
  const normalized = normalizeColumnSlug(slug);
  const match = columns.find((item) => normalizeColumnSlug(item.slug) === normalized);
  if (match) {
    return match;
  }

  return {
    slug,
    name: slug,
    description: "",
    count: 0,
  } satisfies ColumnInfo;
}

export function ColumnDetailClient({
  columns,
  initialSlug,
  initialColumn,
  initialGroups,
  posts,
}: ColumnDetailClientProps) {
  const [activeSlug, setActiveSlug] = useState(initialSlug);
  const [column, setColumn] = useState(initialColumn);
  const [groups, setGroups] = useState(initialGroups);
  const [animationToken, setAnimationToken] = useState(0);
  function handleSwitch(nextSlug: string) {
    if (!nextSlug || nextSlug === activeSlug) {
      return;
    }

    setActiveSlug(nextSlug);
    setColumn(resolveColumn(columns, nextSlug));
    setGroups(groupPostsByYear(filterPostsBySlug(posts, nextSlug)));
    setAnimationToken((value) => value + 1);
    window.history.replaceState(null, "", `/column/${encodeURIComponent(nextSlug)}`);
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
                onClick={() => handleSwitch(item.slug)}
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
