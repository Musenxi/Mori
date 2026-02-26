"use client";

import { LayoutGroup, motion } from "motion/react";
import Link from "next/link";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

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

const sideNavSpring = {
  type: "spring" as const,
  stiffness: 520,
  damping: 40,
  mass: 0.85,
};

function SideNavItem({
  post,
  active,
  activeRef,
  onActivate,
  animationDelayMs,
}: {
  post: NormalizedPost;
  active: boolean;
  activeRef: RefObject<HTMLAnchorElement | null>;
  onActivate: () => void;
  animationDelayMs?: number;
}) {
  return (
    <motion.li
      layout
      transition={{ layout: sideNavSpring }}
      className={cn("relative flex items-center", typeof animationDelayMs === "number" && "mori-stagger-item")}
      style={
        typeof animationDelayMs === "number"
          ? {
            animationDelay: `${animationDelayMs}ms`,
          }
          : undefined
      }
    >
      <Link
        ref={active ? activeRef : null}
        href={post.redirect || `/post/${post.slug}`}
        prefetch={post.redirect ? false : undefined}
        target={post.redirect ? "_blank" : undefined}
        rel={post.redirect ? "noopener noreferrer" : undefined}
        aria-current={active ? "page" : undefined}
        onClick={(event) => {
          if (post.redirect) {
            return;
          }
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
            return;
          }
          onActivate();
        }}
        className={cn(
          "relative min-w-0 flex-1 truncate text-left font-sans text-sm tabular-nums leading-normal transition-all duration-300",
          active
            ? "text-primary opacity-100"
            : "text-secondary opacity-55 hover:text-primary hover:opacity-80",
        )}
        title={post.title}
      >
        {post.title}
      </Link>
    </motion.li>
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
  const [optimisticCid, setOptimisticCid] = useState<number | null>(null);
  const activeLinkRef = useRef<HTMLAnchorElement | null>(null);

  const scrollActiveLinkIntoView = useCallback(() => {
    const activeLink = activeLinkRef.current;
    if (!activeLink) {
      return;
    }

    const container = activeLink.closest<HTMLElement>("[data-side-nav-scroll-container]");
    if (!container) {
      activeLink.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const linkRect = activeLink.getBoundingClientRect();
    const margin = 12;

    if (linkRect.top < containerRect.top + margin) {
      container.scrollTo({
        top: container.scrollTop + (linkRect.top - containerRect.top) - margin,
        behavior: "smooth",
      });
      return;
    }

    if (linkRect.bottom > containerRect.bottom - margin) {
      container.scrollTo({
        top: container.scrollTop + (linkRect.bottom - containerRect.bottom) + margin,
        behavior: "smooth",
      });
    }
  }, []);

  const activeCid = useMemo(() => {
    if (optimisticCid == null) {
      return currentCid;
    }
    return posts.some((post) => post.cid === optimisticCid) ? optimisticCid : currentCid;
  }, [currentCid, optimisticCid, posts]);

  useEffect(() => {
    if (posts.length === 0) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      scrollActiveLinkIntoView();
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [activeCid, posts.length, scrollActiveLinkIntoView]);

  if (posts.length === 0) {
    return null;
  }

  return (
    <LayoutGroup id="mori-side-post-nav-group">
      <ul className={cn("w-full space-y-1", className)} aria-label="文章导航">
        {posts.map((post, index) => (
          <SideNavItem
            key={post.cid}
            post={post}
            active={post.cid === activeCid}
            activeRef={activeLinkRef}
            onActivate={() => setOptimisticCid(post.cid)}
            animationDelayMs={staggered ? staggerStartMs + index * staggerStepMs : undefined}
          />
        ))}
      </ul>
    </LayoutGroup>
  );
}
