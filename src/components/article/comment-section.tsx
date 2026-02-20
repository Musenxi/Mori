"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

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

export function CommentSection({
  slug,
  comments,
  disableForm = false,
  pagination,
  pageQueryKey = "cpage",
}: CommentSectionProps) {
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function buildPageHref(page: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(pageQueryKey, String(page));
    return `${pathname}?${params.toString()}#comment-section`;
  }

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
        <CommentForm slug={slug} onSubmitted={() => setReplyTarget(null)} />
      ) : null}

      <CommentList
        comments={comments}
        onReply={disableForm ? undefined : handleReply}
        canReply={!disableForm}
        activeReplyCoid={replyTarget?.coid}
        replyForm={
          replyTarget ? (
            <CommentForm
              slug={slug}
              replyTarget={replyTarget}
              onCancelReply={() => setReplyTarget(null)}
              onSubmitted={() => setReplyTarget(null)}
            />
          ) : null
        }
      />

      {pagination && pagination.pages > 1 ? (
        <nav className="mt-8 flex items-center justify-center gap-2" aria-label="评论分页">
          <Link
            href={buildPageHref(Math.max(1, pagination.page - 1))}
            className={cn(
              "comment-border rounded-full border px-3 py-1 text-sm text-secondary transition-colors",
              pagination.page <= 1 && "pointer-events-none opacity-40",
            )}
          >
            上一页
          </Link>

          {buildPageList(pagination.page, pagination.pages).map((page) => (
            <Link
              key={page}
              href={buildPageHref(page)}
              className={cn(
                "comment-border min-w-8 rounded-full border px-2 py-1 text-center text-sm transition-colors",
                page === pagination.page ? "bg-primary text-bg" : "text-secondary hover:bg-hover",
              )}
            >
              {page}
            </Link>
          ))}

          <Link
            href={buildPageHref(Math.min(pagination.pages, pagination.page + 1))}
            className={cn(
              "comment-border rounded-full border px-3 py-1 text-sm text-secondary transition-colors",
              pagination.page >= pagination.pages && "pointer-events-none opacity-40",
            )}
          >
            下一页
          </Link>
        </nav>
      ) : null}
    </section>
  );
}
