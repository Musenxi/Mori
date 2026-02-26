import Link from "next/link";

import { NormalizedPost } from "@/lib/typecho-types";
import { cn } from "@/lib/cn";

interface PostCardProps {
  post: NormalizedPost;
  compact?: boolean;
}

export function PostCard({ post, compact = false }: PostCardProps) {
  return (
    <article className={cn("w-full py-8", compact && "py-[15px]")}>
      <Link href={post.redirect || `/post/${post.slug}`} prefetch={!post.redirect ? false : undefined} target={post.redirect ? "_blank" : undefined} rel={post.redirect ? "noopener noreferrer" : undefined} className="group block">
        <div className="flex items-center gap-1">
          <time className="w-[5ch] shrink-0 font-sans text-xs tabular-nums tracking-[0.6px] text-muted">
            {post.shortDate}
          </time>
          <span className="inline-flex items-center justify-center rounded px-[6px] py-px text-[10px] text-muted bg-tag">
            {post.categoryName}
          </span>
        </div>

        <h3
          className={cn(
            "mt-1 font-serif-cn text-[20px] font-bold tracking-[1px] text-primary transition-colors group-hover:text-secondary",
            "leading-[1.6]",
            compact && "text-[21px] leading-normal",
          )}
        >
          {post.title}
        </h3>

        {post.excerpt ? (
          <p
            className={cn(
              "mt-1 font-sans text-sm font-light leading-[1.9] tracking-[0.3px] text-secondary",
              compact && "line-clamp-2",
            )}
          >
            {post.excerpt}
          </p>
        ) : null}
      </Link>
    </article>
  );
}
