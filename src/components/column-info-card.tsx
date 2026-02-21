import Link from "next/link";
import Image from "next/image";

import { cn } from "@/lib/cn";
import { resolveColumnIcon } from "@/lib/column-icon";
import { ColumnInfo } from "@/lib/site-data";

interface ColumnInfoCardProps {
  column: ColumnInfo;
  compact?: boolean;
  hideAction?: boolean;
}

export function ColumnInfoCard({ column, compact = false, hideAction = false }: ColumnInfoCardProps) {
  const resolvedIcon = resolveColumnIcon(column.icon);

  const content = (
    <article
      className={cn(
        "flex items-center gap-6 rounded-xl border border-border bg-card p-6 transition-colors",
        !hideAction && "hover:bg-hover",
        compact && "gap-3 p-4",
      )}
    >
      <div className={cn("flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-muted", compact && "h-12 w-12")}>
        {resolvedIcon?.type === "image" ? (
          <Image
            src={resolvedIcon.src}
            alt=""
            width={36}
            height={36}
            className={cn("h-9 w-9 object-contain", compact && "h-7 w-7")}
            unoptimized
          />
        ) : null}
        {resolvedIcon?.type === "text" ? (
          <span className={cn("font-sans text-2xl leading-none text-primary", compact && "text-xl")}>
            {resolvedIcon.text}
          </span>
        ) : null}
      </div>

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

      {hideAction ? null : <span className={cn("text-xl text-primary", compact && "text-lg")} aria-hidden>〉</span>}
    </article>
  );

  if (hideAction) {
    return content;
  }

  return (
    <Link
      href={column.slug ? `/column/${column.slug}` : "/column"}
      className="block"
      aria-label={`查看 ${column.name} 专栏`}
    >
      {content}
    </Link>
  );
}
