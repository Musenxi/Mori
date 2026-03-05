"use client";

import { useEffect, useMemo, useState } from "react";

import { ColumnInfo } from "@/lib/site-data";
import { cn } from "@/lib/cn";
import { NormalizedPost } from "@/lib/typecho-types";
import { ColumnDirectory } from "@/components/article/column-directory";
import { SidePostNavigation } from "@/components/article/side-post-navigation";

interface DesktopSideNavigationDrawerProps {
  posts: NormalizedPost[];
  currentCid: number;
  column: ColumnInfo | null;
  currentSlug: string;
  articles: NormalizedPost[];
}

export function DesktopSideNavigationDrawer({
  posts,
  currentCid,
  column,
  currentSlug,
  articles,
}: DesktopSideNavigationDrawerProps) {
  const [open, setOpen] = useState(false);

  const hasColumn = useMemo(() => {
    return Boolean(column && articles.length > 0);
  }, [articles.length, column]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (posts.length === 0 && !hasColumn) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-y-0 left-0 z-60 hidden min-[1280px]:block">
      {open ? (
        <button
          type="button"
          aria-label="关闭左侧导航"
          className="pointer-events-auto fixed inset-0 z-0 bg-black/18"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          "pointer-events-auto absolute top-24 left-0 z-10 flex h-[calc(100vh-7rem)] w-[292px] border border-border bg-card shadow-[0_8px_22px_rgba(0,0,0,0.08)] transition-transform duration-300",
          open ? "translate-x-0" : "-translate-x-[292px]",
        )}
      >
        <button
          type="button"
          className="absolute top-6 right-[-40px] inline-flex h-24 w-10 items-center justify-center rounded-r-lg border border-l-0 border-border bg-card font-serif-cn text-[12px] tracking-[1px] text-primary"
          onClick={() => setOpen((previous) => !previous)}
          aria-expanded={open}
          aria-label={open ? "收起左侧导航" : "展开左侧导航"}
        >
          <span className="[writing-mode:vertical-rl]">{open ? "收起" : "导航"}</span>
        </button>

        <div data-side-nav-scroll-container className="min-h-0 w-full overflow-y-auto px-4 py-4">
          {posts.length > 0 ? (
            <SidePostNavigation posts={posts} currentCid={currentCid} className={hasColumn ? "mb-6" : undefined} />
          ) : null}

          {column ? (
            <ColumnDirectory column={column} currentSlug={currentSlug} articles={articles} />
          ) : null}
        </div>
      </aside>
    </div>
  );
}
