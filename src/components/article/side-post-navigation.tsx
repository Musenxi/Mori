import Link from "next/link";

import { cn } from "@/lib/cn";
import { NormalizedPost } from "@/lib/typecho-types";

interface SidePostNavigationProps {
  posts: NormalizedPost[];
  currentCid: number;
  className?: string;
}

function SideNavItem({ post, active }: { post: NormalizedPost; active: boolean }) {
  return (
    <li className="flex items-center">
      <Link
        href={`/post/${post.slug}`}
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

export function SidePostNavigation({ posts, currentCid, className }: SidePostNavigationProps) {
  if (posts.length === 0) {
    return null;
  }

  return (
    <ul className={cn("w-full space-y-1", className)} aria-label="文章导航">
      {posts.map((post) => (
        <SideNavItem key={post.cid} post={post} active={post.cid === currentCid} />
      ))}
    </ul>
  );
}
