import Link from "next/link";

import { cn } from "@/lib/cn";
import { NormalizedPost } from "@/lib/typecho-types";

interface SidePostNavigationProps {
  posts: NormalizedPost[];
  currentCid: number;
  className?: string;
  staggered?: boolean;
  staggerStartMs?: number;
  staggerStepMs?: number;
}

function SideNavItem({
  post,
  active,
  animationDelayMs,
}: {
  post: NormalizedPost;
  active: boolean;
  animationDelayMs?: number;
}) {
  return (
    <li
      className={cn("flex items-center", typeof animationDelayMs === "number" && "mori-stagger-item")}
      style={
        typeof animationDelayMs === "number"
          ? {
              animationDelay: `${animationDelayMs}ms`,
            }
          : undefined
      }
    >
      <Link
        href={`/post/${post.slug}`}
        prefetch={false}
        aria-current={active ? "page" : undefined}
        className={cn(
          "min-w-0 flex-1 truncate text-left font-serif-cn text-[13px] leading-[1.5] transition-all",
          active
            ? "font-semibold text-primary opacity-100"
            : "text-secondary opacity-55 hover:text-primary hover:opacity-80",
        )}
        title={post.title}
      >
        {post.title}
      </Link>
    </li>
  );
}

export function SidePostNavigation({
  posts,
  currentCid,
  className,
  staggered = false,
  staggerStartMs = 0,
  staggerStepMs = 44,
}: SidePostNavigationProps) {
  if (posts.length === 0) {
    return null;
  }

  return (
    <ul className={cn("w-full space-y-1", className)} aria-label="文章导航">
      {posts.map((post, index) => (
        <SideNavItem
          key={post.cid}
          post={post}
          active={post.cid === currentCid}
          animationDelayMs={staggered ? staggerStartMs + index * staggerStepMs : undefined}
        />
      ))}
    </ul>
  );
}
