"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CommentForm, ReplyTarget } from "@/components/article/comment-form";
import { CommentList } from "@/components/article/comment-list";
import { CommentPagination, NormalizedComment } from "@/lib/typecho-types";
import { cn } from "@/lib/cn";

interface CommentSectionProps {
  slug: string;
  comments: NormalizedComment[];
  disableForm?: boolean;
  pagination?: CommentPagination;
  pageQueryKey?: string;
}

function buildPageList(current: number, total: number) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  [...pages].forEach((page) => {
    if (page < 1 || page > total) {
      pages.delete(page);
    }
  });

  return [...pages].sort((a, b) => a - b);
}

function parsePositivePage(value: string | null | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function CommentSection({
  slug,
  comments,
  disableForm = false,
  pagination,
  pageQueryKey = "cpage",
}: CommentSectionProps) {
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [currentComments, setCurrentComments] = useState(comments);
  const [currentPagination, setCurrentPagination] = useState<CommentPagination | undefined>(pagination);
  const [loadingPage, setLoadingPage] = useState(false);
  const [feedback, setFeedback] = useState("");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const syncedQueryPageRef = useRef<number | null>(null);

  const pageSize = useMemo(() => currentPagination?.pageSize || pagination?.pageSize || 10, [currentPagination, pagination]);

  useEffect(() => {
    setCurrentComments(comments);
    setCurrentPagination(pagination);
    setReplyTarget(null);
    setFeedback("");
    syncedQueryPageRef.current = null;
  }, [slug, comments, pagination]);

  const buildPageUrl = useCallback((page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(pageQueryKey, String(page));
    return `${pathname}?${params.toString()}#comment-section`;
  }, [pageQueryKey, pathname, searchParams]);

  const refreshComments = useCallback(
    async (
      page: number,
      options?: { preserveExistingOnEmpty?: boolean; fresh?: boolean },
    ): Promise<{ ok: boolean; commentCount: number }> => {
      if (loadingPage) {
        return { ok: false, commentCount: currentComments.length };
      }

      setLoadingPage(true);
      setFeedback("");

      try {
        const query = new URLSearchParams({
          slug,
          page: String(page),
          pageSize: String(pageSize),
        });
        if (options?.fresh) {
          query.set("fresh", "1");
          query.set("_ts", String(Date.now()));
        }

        const response = await fetch(
          `/api/comments?${query.toString()}`,
          { method: "GET", cache: options?.fresh ? "no-store" : "force-cache" },
        );

        const result = (await response.json()) as {
          ok: boolean;
          message?: string;
          data?: {
            comments: NormalizedComment[];
            pagination: CommentPagination;
          };
        };

        if (!response.ok || !result.ok || !result.data) {
          throw new Error(result.message || "评论加载失败，请稍后重试。");
        }

        const payload = result.data;
        const nextCommentCount = payload.comments.length;
        if (options?.preserveExistingOnEmpty && payload.comments.length === 0) {
          setCurrentComments((prev) => (prev.length > 0 ? prev : payload.comments));
        } else {
          setCurrentComments(payload.comments);
        }
        setCurrentPagination(payload.pagination);
        window.history.replaceState(null, "", buildPageUrl(payload.pagination.page));
        return { ok: true, commentCount: nextCommentCount };
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "评论加载失败，请稍后重试。");
        return { ok: false, commentCount: currentComments.length };
      } finally {
        setLoadingPage(false);
      }
    },
    [buildPageUrl, currentComments.length, loadingPage, pageSize, slug],
  );

  useEffect(() => {
    if (!currentPagination) {
      return;
    }

    const queryPage = parsePositivePage(searchParams.get(pageQueryKey));
    if (queryPage <= 1 || queryPage > currentPagination.pages) {
      return;
    }

    if (queryPage === currentPagination.page) {
      syncedQueryPageRef.current = queryPage;
      return;
    }

    if (syncedQueryPageRef.current === queryPage) {
      return;
    }

    syncedQueryPageRef.current = queryPage;
    void refreshComments(queryPage, { preserveExistingOnEmpty: true });
  }, [currentPagination, pageQueryKey, refreshComments, searchParams]);

  function handleReply(target: ReplyTarget) {
    if (disableForm) {
      return;
    }

    setReplyTarget(target);
  }

  return (
    <section className="w-full" id="comment-section">
      {disableForm ? (
        <div className="comment-border mb-6 rounded-md border bg-tag px-3 py-2">
          <p className="font-sans text-sm text-secondary">评论功能已关闭，仅展示历史评论。</p>
        </div>
      ) : null}

      {!disableForm && !replyTarget ? (
        <CommentForm
          slug={slug}
          onSubmitted={async () => {
            setReplyTarget(null);
            await refreshComments(1, { preserveExistingOnEmpty: true, fresh: true });
          }}
        />
      ) : null}

      <CommentList
        comments={currentComments}
        onReply={disableForm ? undefined : handleReply}
        canReply={!disableForm}
        activeReplyCoid={replyTarget?.coid}
        replyForm={
          replyTarget ? (
            <CommentForm
              slug={slug}
              replyTarget={replyTarget}
              onCancelReply={() => setReplyTarget(null)}
              onSubmitted={async () => {
                setReplyTarget(null);
                await refreshComments(1, { preserveExistingOnEmpty: true, fresh: true });
              }}
            />
          ) : null
        }
      />

      {feedback ? <p className="mt-4 text-center font-sans text-sm text-secondary">{feedback}</p> : null}

      {currentPagination && currentPagination.pages > 1 ? (
        <nav className="mt-8 flex items-center justify-center gap-2" aria-label="评论分页">
          <button
            type="button"
            onClick={() => void refreshComments(Math.max(1, currentPagination.page - 1))}
            className={cn(
              "comment-border rounded-full border px-3 py-1 text-sm text-secondary transition-colors",
              (loadingPage || currentPagination.page <= 1) && "pointer-events-none opacity-40",
            )}
            disabled={loadingPage || currentPagination.page <= 1}
          >
            上一页
          </button>

          {buildPageList(currentPagination.page, currentPagination.pages).map((page) => (
            <button
              type="button"
              key={page}
              onClick={() => void refreshComments(page)}
              className={cn(
                "comment-border min-w-8 rounded-full border px-2 py-1 text-center text-sm transition-colors",
                page === currentPagination.page ? "bg-primary text-bg" : "text-secondary hover:bg-hover",
                loadingPage && "pointer-events-none opacity-60",
              )}
              disabled={loadingPage || page === currentPagination.page}
            >
              {page}
            </button>
          ))}

          <button
            type="button"
            onClick={() => void refreshComments(Math.min(currentPagination.pages, currentPagination.page + 1))}
            className={cn(
              "comment-border rounded-full border px-3 py-1 text-sm text-secondary transition-colors",
              (loadingPage || currentPagination.page >= currentPagination.pages) && "pointer-events-none opacity-40",
            )}
            disabled={loadingPage || currentPagination.page >= currentPagination.pages}
          >
            下一页
          </button>
        </nav>
      ) : null}
    </section>
  );
}
