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
      <p className="font-serif-cn text-xs leading-[1.5] tracking-[0.5px] text-muted">此文章收录于专栏：</p>
      <h3 className="font-serif-cn text-base font-bold leading-[1.4] tracking-[1px] text-primary">{column.name}</h3>
      <div className="h-px w-[150px] bg-border" />
      <p className="font-serif-cn text-xs leading-[1.5] tracking-[0.5px] text-muted">此专栏的其他文章：</p>

      <div className="flex flex-col gap-3">
        {articles.map((article, index) => {
          const active = article.slug === currentSlug;
          return (
            <Link
              key={article.cid}
              href={`/post/${article.slug}`}
              style={
                staggered
                  ? {
                      animationDelay: `${staggerStartMs + index * staggerStepMs}ms`,
                    }
                  : undefined
              }
              className={cn(
                "font-serif-cn text-sm leading-[1.5] text-muted transition-colors hover:text-primary",
                staggered && "mori-stagger-item",
                active && "flex items-center gap-2 text-primary",
              )}
            >
              {active ? <span className="h-[14px] w-[2px] bg-primary" aria-hidden /> : null}
              <span>{article.title}</span>
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
