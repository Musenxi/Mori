import Link from "next/link";

import { cn } from "@/lib/cn";
import { ColumnInfo } from "@/lib/site-data";

interface ColumnCardProps {
  column: ColumnInfo;
  compact?: boolean;
  disableArrow?: boolean;
  href?: string;
}

export function ColumnCard({ column, compact = false, disableArrow = false, href }: ColumnCardProps) {
  const content = (
    <article
      className={cn(
        "flex items-center gap-6 rounded-xl px-6 py-6 transition-colors",
        "hover:bg-hover",
        compact && "gap-3 px-4 py-4",
      )}
    >
      <div
        className={cn(
          "h-16 w-16 shrink-0 rounded-lg bg-muted",
          compact && "h-12 w-12",
        )}
        aria-hidden
      />

      <div className="min-w-0 flex-1">
        <h3
          className={cn(
            "font-serif-cn text-[20px] font-bold text-primary",
            compact && "text-base",
          )}
        >
          {column.name}
        </h3>
        <p
          className={cn(
            "mt-2 line-clamp-2 font-sans text-sm leading-[1.5] text-secondary",
            compact && "mt-1 text-[13px] leading-[1.4]",
          )}
        >
          {column.description || "探索设计背后的思维模型与美学原则，重塑数字体验。"}
        </p>
      </div>

      {disableArrow ? null : (
        <span className={cn("text-xl text-primary", compact && "text-lg")} aria-hidden>
          →
        </span>
      )}
    </article>
  );

  if (!href) {
    return content;
  }

  return (
    <Link href={href} className="block border-b border-border last:border-b-0">
      {content}
    </Link>
  );
}
