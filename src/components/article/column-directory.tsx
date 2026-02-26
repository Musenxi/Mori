"use client";

import { LayoutGroup, motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ColumnInfo } from "@/lib/site-data";
import { NormalizedPost } from "@/lib/typecho-types";
import { cn } from "@/lib/cn";

interface ColumnDirectoryProps {
  column: ColumnInfo;
  currentSlug: string;
  articles: NormalizedPost[];
  staggered?: boolean;
  staggerStartMs?: number;
  staggerStepMs?: number;
}

const columnNavSpring = {
  type: "spring" as const,
  stiffness: 520,
  damping: 40,
  mass: 0.85,
};

export function ColumnDirectory({
  column,
  currentSlug,
  articles,
  staggered = false,
  staggerStartMs = 0,
  staggerStepMs = 44,
}: ColumnDirectoryProps) {
  const [optimisticSlug, setOptimisticSlug] = useState<string | null>(null);

  const activeSlug = useMemo(() => {
    if (!optimisticSlug) {
      return currentSlug;
    }
    return articles.some((article) => article.slug === optimisticSlug) ? optimisticSlug : currentSlug;
  }, [articles, currentSlug, optimisticSlug]);

  return (
    <aside className="flex flex-col gap-3">
      <div className="h-px w-[150px] bg-border" />
      <p className="font-serif-cn text-sm leading-normal tracking-[0.5px] text-muted">此文章收录于专栏：</p>
      <Link
        href={column.slug ? `/column/${column.slug}` : "/column"}
        prefetch={false}
        className="font-serif-cn text-base font-bold leading-[1.4] tracking-[1px] text-primary transition-opacity duration-300 hover:opacity-70"
      >
        {column.name}
      </Link>
      <div className="h-px w-[150px] bg-border" />
      <p className="font-serif-cn text-sm leading-normal tracking-[0.5px] text-muted">此专栏的文章：</p>

      <LayoutGroup id="mori-column-dir-nav-group">
        <ul className="w-full space-y-1">
          {articles.map((article, index) => {
            const active = article.slug === activeSlug;
            return (
              <motion.li
                key={article.cid}
                layout
                transition={{ layout: columnNavSpring }}
                className={cn("relative flex items-center", staggered && "mori-stagger-item")}
                style={
                  staggered
                    ? {
                      animationDelay: `${staggerStartMs + index * staggerStepMs}ms`,
                    }
                    : undefined
                }
              >
                {active ? (
                  <motion.span
                    layoutId="mori-column-dir-indicator"
                    transition={columnNavSpring}
                    className="pointer-events-none absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-sm bg-primary"
                    aria-hidden
                  />
                ) : null}

                <Link
                  href={article.redirect || `/post/${article.slug}`}
                  prefetch={article.redirect ? false : undefined}
                  target={article.redirect ? "_blank" : undefined}
                  rel={article.redirect ? "noopener noreferrer" : undefined}
                  aria-current={active ? "page" : undefined}
                  onClick={(event) => {
                    if (article.redirect) {
                      return;
                    }
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
                      return;
                    }
                    setOptimisticSlug(article.slug);
                  }}
                  className={cn(
                    "relative min-w-0 flex-1 truncate pl-3 text-left font-sans text-sm tabular-nums leading-normal transition-all duration-300",
                    active
                      ? "text-primary opacity-100"
                      : "text-secondary opacity-55 hover:text-primary hover:opacity-80",
                  )}
                  title={article.title}
                >
                  {article.title}
                </Link>
              </motion.li>
            );
          })}
        </ul>
      </LayoutGroup>
    </aside>
  );
}
