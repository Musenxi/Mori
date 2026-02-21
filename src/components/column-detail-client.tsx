"use client";

import { useState } from "react";

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

export function ColumnDetailClient({
  columns,
  initialSlug,
  initialColumn,
  initialGroups,
}: ColumnDetailClientProps) {
  const [activeSlug, setActiveSlug] = useState(initialSlug);
  const [column, setColumn] = useState(initialColumn);
  const [groups, setGroups] = useState(initialGroups);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSwitch(nextSlug: string) {
    if (loading || !nextSlug || nextSlug === activeSlug) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/column-detail?slug=${encodeURIComponent(nextSlug)}&_t=${Date.now()}`, {
        method: "GET",
        cache: "no-store",
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

      setActiveSlug(nextSlug);
      setColumn(result.data.column);
      setGroups(result.data.groups);
      window.history.replaceState(null, "", `/column/${encodeURIComponent(nextSlug)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "专栏数据加载失败。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="flex flex-col gap-8 md:gap-[60px]">
      {columns.length > 1 ? (
        <nav className="flex flex-wrap gap-3" aria-label="专栏切换">
          {columns.map((item) => (
            <button
              key={item.slug}
              type="button"
              onClick={() => void handleSwitch(item.slug)}
              disabled={loading}
              className={cn(
                "inline-flex items-center rounded-full px-4 py-1.5 font-sans text-sm transition-colors",
                item.slug === activeSlug ? "bg-primary text-bg" : "bg-tag text-secondary hover:bg-hover",
                loading && "cursor-not-allowed opacity-60",
              )}
            >
              {item.name}
            </button>
          ))}
        </nav>
      ) : null}

      {error ? <p className="font-sans text-sm leading-8 text-secondary">{error}</p> : null}
      {loading ? <p className="font-sans text-sm leading-8 text-secondary">加载中...</p> : null}

      <ColumnInfoCard column={column} hideAction />
      <div className="h-px w-full bg-border" />

      {!loading ? (
        groups.length > 0 ? (
          <YearPostGroups groups={groups} />
        ) : (
          <p className="font-sans text-sm leading-8 text-secondary">该专栏暂无文章。</p>
        )
      ) : null}
    </section>
  );
}
