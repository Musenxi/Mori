"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/cn";
import { springScrollToTop } from "@/lib/scroller";
import { getRealtimeSocket } from "@/lib/realtime-socket";
import {
    PostCounterRealtimePayload,
    TypechoPostCounter,
} from "@/lib/typecho-types";

interface TocActionsProps {
    cid: number;
    slug: string;
    initialLikeCount: string;
    className?: string;
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

export function TocActions({ cid, slug, initialLikeCount, className }: TocActionsProps) {
    const [likesNum, setLikesNum] = useState<number | null>(() => {
        const parsed = Number.parseInt(initialLikeCount.replace(/[^\d]/g, ""), 10);
        return Number.isFinite(parsed) ? parsed : null;
    });
    const [liked, setLiked] = useState(false);
    const [likePending, setLikePending] = useState(false);
    const [showScrollTop, setShowScrollTop] = useState(false);

    const applyCounter = useCallback((counter?: TypechoPostCounter) => {
        if (!counter) {
            return;
        }
        setLikesNum(Number.isFinite(counter.likesNum) ? counter.likesNum : null);
        setLiked(Boolean(counter.liked));
    }, []);

    const applyRealtimeCounter = useCallback((counter?: PostCounterRealtimePayload) => {
        if (!counter) {
            return;
        }

        const likes = Number(counter.likesNum);
        setLikesNum(Number.isFinite(likes) ? Math.max(0, Math.floor(likes)) : null);
    }, []);

    const loadStats = useCallback(async () => {
        const response = await fetch(`/api/post-stats?cid=${cid}&slug=${encodeURIComponent(slug)}`, {
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
    }, [applyCounter, cid, slug]);

    const requestCounter = useCallback(
        async (action: "like") => {
            if (hasRecentClientLock(action, cid)) {
                await loadStats();
                return;
            }

            setClientLock(action, cid);

            const response = await fetch("/api/post-stats", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                cache: "no-cache",
                body: JSON.stringify({
                    action,
                    cid,
                    slug,
                }),
            });

            if (!response.ok) {
                clearClientLock(action, cid);
                return;
            }

            const payload = (await response.json()) as CounterResponseEnvelope;
            if (!payload.ok) {
                clearClientLock(action, cid);
                return;
            }

            applyCounter(payload.data);
        },
        [applyCounter, loadStats, cid, slug],
    );

    // Load initial stats
    useEffect(() => {
        void loadStats();
    }, [loadStats]);

    // Subscribe to realtime counter updates
    useEffect(() => {
        let disposed = false;

        async function setupSocketSubscription() {
            try {
                const socket = await getRealtimeSocket();
                if (disposed) {
                    return;
                }

                const handleCounterUpdated = (payload: PostCounterRealtimePayload) => {
                    const payloadCid = Number(payload?.cid);
                    const payloadSlug = typeof payload?.slug === "string" ? payload.slug : "";
                    if (payloadCid !== cid && payloadSlug !== slug) {
                        return;
                    }

                    applyRealtimeCounter(payload);
                };

                socket.on(POST_COUNTER_UPDATED_EVENT, handleCounterUpdated);

                return () => {
                    socket.off(POST_COUNTER_UPDATED_EVENT, handleCounterUpdated);
                };
            } catch {
                return undefined;
            }
        }

        let localCleanup: (() => void) | undefined;
        void setupSocketSubscription().then((cleanup) => {
            localCleanup = cleanup;
        });

        return () => {
            disposed = true;
            localCleanup?.();
        };
    }, [applyRealtimeCounter, cid, slug]);

    // Show/hide scroll-to-top based on scroll position
    useEffect(() => {
        const handleScroll = () => {
            setShowScrollTop(window.scrollY > 400);
        };

        handleScroll();
        window.addEventListener("scroll", handleScroll, { passive: true });
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

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

    const handleScrollToTop = useCallback(() => {
        void springScrollToTop();
    }, []);

    const likeCountLabel = useMemo(() => {
        if (likesNum === null) {
            return initialLikeCount;
        }
        return String(likesNum);
    }, [initialLikeCount, likesNum]);

    return (
        <div className={cn("fixed bottom-6 right-6 z-50 flex flex-col items-center gap-3", className)}>
            {/* Like (heart) button */}
            <button
                type="button"
                onClick={() => {
                    void handleLike();
                }}
                disabled={liked || likePending}
                className={cn(
                    "group relative flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300",
                    "bg-bg border border-border",
                    "shadow-sm hover:shadow-md",
                    liked
                        ? "cursor-default text-[#e74c6f]"
                        : "cursor-pointer text-muted hover:text-[#e74c6f]",
                    likePending && "animate-pulse",
                )}
                aria-label={liked ? "已点赞" : "点赞"}
                title={liked ? `已点赞 ${likeCountLabel}` : `点赞 ${likeCountLabel}`}
            >
                <svg
                    viewBox="0 0 24 24"
                    className={cn(
                        "h-[18px] w-[18px] transition-transform duration-300",
                        !liked && "group-hover:scale-110",
                        liked && "scale-110",
                    )}
                    fill={liked ? "currentColor" : "none"}
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
                {/* Like count badge */}
                {likesNum !== null && likesNum > 0 ? (
                    <span
                        className={cn(
                            "absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-medium leading-none",
                            liked
                                ? "bg-[#e74c6f] text-white"
                                : "bg-tag text-secondary",
                        )}
                    >
                        {likeCountLabel}
                    </span>
                ) : null}
            </button>

            {/* Scroll to top button */}
            <button
                type="button"
                onClick={handleScrollToTop}
                className={cn(
                    "group flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300",
                    "bg-bg border border-border",
                    "shadow-sm hover:shadow-md",
                    "cursor-pointer text-muted hover:text-primary",
                    showScrollTop ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
                )}
                aria-label="回到顶部"
                title="回到顶部"
            >
                <svg
                    viewBox="0 0 24 24"
                    className="h-[18px] w-[18px] transition-transform duration-300 group-hover:-translate-y-0.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d="M18 15l-6-6-6 6" />
                </svg>
            </button>
        </div>
    );
}
