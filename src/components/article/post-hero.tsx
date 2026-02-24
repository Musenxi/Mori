"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";

import { NormalizedPost, PostCounterRealtimePayload, TypechoPostCounter } from "@/lib/typecho-types";

interface PostHeroProps {
  post: NormalizedPost & { coverImage?: string };
  readCount: string;
  likeCount: string;
  wordCount: number;
}

interface CounterResponseEnvelope {
  ok: boolean;
  data?: TypechoPostCounter;
}

const POST_COUNTER_UPDATED_EVENT = "post:counter-updated";

function getClientLockKey(metric: "view" | "like", cid: number) {
  return `mori:${metric}:lock:${cid}`;
}

function hasRecentClientLock(metric: "view" | "like", cid: number, ttlMs = 8000) {
  if (typeof window === "undefined") {
    return false;
  }

  const key = getClientLockKey(metric, cid);
  const raw = window.sessionStorage.getItem(key);
  if (!raw) {
    return false;
  }

  const ts = Number.parseInt(raw, 10);
  if (!Number.isFinite(ts)) {
    window.sessionStorage.removeItem(key);
    return false;
  }

  const fresh = Date.now() - ts < ttlMs;
  if (!fresh) {
    window.sessionStorage.removeItem(key);
    return false;
  }

  return true;
}

function setClientLock(metric: "view" | "like", cid: number) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(getClientLockKey(metric, cid), String(Date.now()));
}

function clearClientLock(metric: "view" | "like", cid: number) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(getClientLockKey(metric, cid));
}

function MetaItem({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="inline-flex h-4 w-4 items-center justify-center text-muted" aria-hidden>
        {icon}
      </span>
      <span>{children}</span>
    </span>
  );
}

export function PostHero({ post, readCount, likeCount, wordCount }: PostHeroProps) {
  const [viewsNum, setViewsNum] = useState<number | null>(() => {
    const parsed = Number.parseInt(readCount.replace(/[^\d]/g, ""), 10);
    return Number.isFinite(parsed) ? parsed : null;
  });
  const [likesNum, setLikesNum] = useState<number | null>(() => {
    const parsed = Number.parseInt(likeCount.replace(/[^\d]/g, ""), 10);
    return Number.isFinite(parsed) ? parsed : null;
  });
  const [liked, setLiked] = useState(false);
  const [likePending, setLikePending] = useState(false);

  const applyCounter = useCallback((counter?: TypechoPostCounter) => {
    if (!counter) {
      return;
    }
    setViewsNum(Number.isFinite(counter.viewsNum) ? counter.viewsNum : null);
    setLikesNum(Number.isFinite(counter.likesNum) ? counter.likesNum : null);
    setLiked(Boolean(counter.liked));
  }, []);

  const applyRealtimeCounter = useCallback((counter?: PostCounterRealtimePayload) => {
    if (!counter) {
      return;
    }

    const views = Number(counter.viewsNum);
    const likes = Number(counter.likesNum);
    setViewsNum(Number.isFinite(views) ? Math.max(0, Math.floor(views)) : null);
    setLikesNum(Number.isFinite(likes) ? Math.max(0, Math.floor(likes)) : null);
  }, []);

  const loadStats = useCallback(async () => {
    const response = await fetch(`/api/post-stats?cid=${post.cid}&slug=${encodeURIComponent(post.slug)}`, {
      method: "GET",
      cache: "no-cache",
    });

    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as CounterResponseEnvelope;
    if (!payload.ok) {
      return;
    }

    applyCounter(payload.data);
  }, [applyCounter, post.cid, post.slug]);

  const requestCounter = useCallback(
    async (action: "view" | "like") => {
      if (hasRecentClientLock(action, post.cid)) {
        await loadStats();
        return;
      }

      // 前端本地短时锁，避免 React StrictMode 开发环境双执行导致并发重复上报。
      setClientLock(action, post.cid);

      const response = await fetch("/api/post-stats", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-cache",
        body: JSON.stringify({
          action,
          cid: post.cid,
          slug: post.slug,
        }),
      });

      if (!response.ok) {
        clearClientLock(action, post.cid);
        return;
      }

      const payload = (await response.json()) as CounterResponseEnvelope;
      if (!payload.ok) {
        clearClientLock(action, post.cid);
        return;
      }

      applyCounter(payload.data);
    },
    [applyCounter, loadStats, post.cid, post.slug],
  );

  useEffect(() => {
    void requestCounter("view");
  }, [requestCounter]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;

    async function setupSocketSubscription() {
      try {
        const { io } = await import("socket.io-client");
        if (disposed) {
          return;
        }

        const socket = io({
          path: "/socket.io",
          transports: ["websocket", "polling"],
        });

        const handleCounterUpdated = (payload: PostCounterRealtimePayload) => {
          const payloadCid = Number(payload?.cid);
          const payloadSlug = typeof payload?.slug === "string" ? payload.slug : "";
          if (payloadCid !== post.cid && payloadSlug !== post.slug) {
            return;
          }

          applyRealtimeCounter(payload);
        };

        socket.on(POST_COUNTER_UPDATED_EVENT, handleCounterUpdated);
        socket.emit("post:join", { cid: post.cid, slug: post.slug });

        cleanup = () => {
          socket.off(POST_COUNTER_UPDATED_EVENT, handleCounterUpdated);
          socket.emit("post:leave", { cid: post.cid, slug: post.slug });
          socket.disconnect();
        };
      } catch {
        // Ignore socket initialization errors and keep HTTP fallback.
      }
    }

    void setupSocketSubscription();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [applyRealtimeCounter, post.cid, post.slug]);

  const handleLike = useCallback(async () => {
    if (liked || likePending) {
      return;
    }

    setLikePending(true);
    try {
      await requestCounter("like");
    } finally {
      setLikePending(false);
    }
  }, [likePending, liked, requestCounter]);

  const readCountLabel = useMemo(() => {
    if (viewsNum === null) {
      return readCount;
    }
    return String(viewsNum);
  }, [readCount, viewsNum]);

  const likeCountLabel = useMemo(() => {
    if (likesNum === null) {
      return likeCount;
    }
    return String(likesNum);
  }, [likeCount, likesNum]);

  return (
    <section className="mx-auto flex w-full max-w-[1104px] flex-col items-center gap-6 pt-10 md:pt-10">
      <h1 className="w-full max-w-[850px] text-center font-serif-cn text-[32px] leading-[1.4] tracking-[2px] text-primary md:text-[42px]">
        {post.title}
      </h1>

      <div className="flex w-full max-w-[850px] flex-wrap items-center justify-center gap-x-2 gap-y-1.5 font-sans text-sm tracking-[0.5px] text-muted">
        <MetaItem
          icon={
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.8v4.8l3.1 1.9" />
            </svg>
          }
        >
          <time>{post.createdLabel}</time>
        </MetaItem>
        <MetaItem
          icon={
            <svg viewBox="0 0 24 24" className="h-3.5 w-3" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M10 4 8.4 20M16 4l-1.6 16M5.8 9h13.2M5 15h13.2" />
            </svg>
          }
        >
          <span>{post.categoryName}</span>
        </MetaItem>
        <MetaItem
          icon={
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 20h4l11-11-4-4L4 16v4Z" />
              <path d="m13.5 6.5 4 4" />
            </svg>
          }
        >
          <span>{wordCount}字</span>
        </MetaItem>
        <MetaItem
          icon={
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6Z" />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
          }
        >
          <span>{readCountLabel}</span>
        </MetaItem>
        <button
          type="button"
          onClick={() => {
            void handleLike();
          }}
          disabled={liked || likePending}
          className="inline-flex items-center gap-1 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-70"
          aria-label={liked ? "已点赞" : "点赞"}
          title={liked ? "已点赞" : "点赞"}
        >
          <span className="inline-flex h-4 w-4 items-center justify-center text-muted" aria-hidden>
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 21H6a2 2 0 0 1-2-2v-7h4v9Z" />
              <path d="M10 21h6.2a2 2 0 0 0 1.94-1.53l1.56-6.2A2 2 0 0 0 17.76 11H14V7.8a2.8 2.8 0 0 0-2.8-2.8L10 9v12Z" />
            </svg>
          </span>
          <span>{likeCountLabel}</span>
        </button>
      </div>

      {post.coverImage ? (
        <figure className="w-full">
          <Image
            src={post.coverImage}
            alt={post.title}
            width={1104}
            height={460}
            unoptimized
            className="h-[245px] w-full object-cover md:h-[460px]"
          />
        </figure>
      ) : null}
    </section>
  );
}
