import Link from "next/link";

import { cn } from "@/lib/cn";
import { ColumnInfo } from "@/lib/site-data";

interface ColumnInfoCardProps {
  column: ColumnInfo;
  compact?: boolean;
  hideAction?: boolean;
}

export function ColumnInfoCard({ column, compact = false, hideAction = false }: ColumnInfoCardProps) {
  return (
    <article
      className={cn(
        "flex items-center gap-6 rounded-xl border border-border bg-card p-6",
        compact && "gap-3 p-4",
      )}
    >
      <div className={cn("h-16 w-16 shrink-0 rounded-lg bg-muted", compact && "h-12 w-12")} />

      <div className="min-w-0 flex-1">
        {!compact ? (
          <p className="font-sans text-xs tracking-[0.5px] text-muted">所属专栏</p>
        ) : null}
        <h3 className={cn("font-serif-cn text-[20px] font-bold text-primary", compact && "text-base")}>
          {column.name}
        </h3>
        <p className={cn("mt-2 font-sans text-sm leading-[1.5] text-secondary", compact && "mt-1 text-[13px] leading-[1.4]")}>
          {column.description || "探索设计背后的思维模型与美学原则，重塑数字体验。"}
        </p>
      </div>

      {hideAction ? null : (
        <Link
          href={column.slug ? `/column/${column.slug}` : "/column"}
          className="inline-flex h-8 w-8 items-center justify-center rounded-2xl text-xl text-primary transition-colors hover:bg-hover"
          aria-label={`查看 ${column.name} 专栏`}
        >
          →
        </Link>
      )}
    </article>
  );
}
