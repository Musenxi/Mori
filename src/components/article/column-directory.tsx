import Link from "next/link";

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

export function ColumnDirectory({
  column,
  currentSlug,
  articles,
  staggered = false,
  staggerStartMs = 0,
  staggerStepMs = 44,
}: ColumnDirectoryProps) {
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

      <ul className="w-full space-y-1">
        {articles.map((article, index) => {
          const active = article.slug === currentSlug;
          return (
            <li
              key={article.cid}
              className={cn("flex items-center", staggered && "mori-stagger-item")}
              style={
                staggered
                  ? {
                    animationDelay: `${staggerStartMs + index * staggerStepMs}ms`,
                  }
                  : undefined
              }
            >
              <Link
                href={`/post/${article.slug}`}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "min-w-0 flex-1 truncate text-left font-sans text-sm tabular-nums leading-normal transition-all duration-300",
                  active
                    ? "text-primary opacity-100"
                    : "text-secondary opacity-55 hover:text-primary hover:opacity-80",
                )}
                title={article.title}
              >
                {article.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
