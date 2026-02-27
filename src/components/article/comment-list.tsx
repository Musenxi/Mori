"use client";

import { ReactNode, useState } from "react";

import { NormalizedComment } from "@/lib/typecho-types";
import { cn } from "@/lib/cn";
import type { ReplyTarget } from "@/components/article/comment-form";

interface CommentListProps {
  comments: NormalizedComment[];
  onReply?: (target: ReplyTarget) => void;
  canReply?: boolean;
  activeReplyCoid?: number | null;
  replyForm?: ReactNode;
}

function normalizeAuthorUrl(url?: string) {
  if (!url) {
    return null;
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  const withScheme =
    trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function CommentItem({
  comment,
  depth,
  onReply,
  canReply,
  activeReplyCoid,
  replyForm,
}: {
  comment: NormalizedComment;
  depth: number;
  onReply?: (target: ReplyTarget) => void;
  canReply: boolean;
  activeReplyCoid?: number | null;
  replyForm?: ReactNode;
}) {
  const authorUrl = normalizeAuthorUrl(comment.url);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const showAvatar = Boolean(comment.avatarUrl) && !avatarFailed;

  return (
    <article className={cn("pt-8", depth === 1 && "pl-8 md:pl-12", depth >= 2 && "pl-6 md:pl-16")}>
      <div className="flex gap-3 md:gap-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-tag md:h-10 md:w-10">
          {showAvatar ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={comment.avatarUrl}
              alt={`${comment.author} 的头像`}
              className="h-full w-full rounded-[10px] object-cover"
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setAvatarFailed(true)}
            />
          ) : (
            <span className="font-serif-cn text-base text-primary">{comment.initial}</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {authorUrl ? (
              <a
                href={authorUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="font-serif-cn text-[15px] font-bold tracking-[1px] text-primary underline-offset-2 transition-opacity hover:opacity-70 hover:underline"
              >
                {comment.author}
              </a>
            ) : (
              <span className="font-serif-cn text-[15px] font-bold tracking-[1px] text-primary">
                {comment.author}
              </span>
            )}
            {comment.replyTo ? (
              <span className="inline-flex items-center gap-[5px]">
                <span className="font-serif-cn text-[13px] text-muted/80">&gt;</span>
                <span className="font-serif-cn text-[15px] font-bold tracking-[1px] text-primary">
                  {comment.replyTo}
                </span>
              </span>
            ) : null}
            <time className="font-sans text-xs text-muted">{comment.createdLabel}</time>
          </div>

          <div
            className="mt-3 font-sans text-sm leading-[1.8] text-primary prose-comment"
            suppressHydrationWarning
            dangerouslySetInnerHTML={{ __html: comment.html }}
          />

          {canReply ? (
            <button
              type="button"
              onClick={() =>
                onReply?.({
                  coid: comment.coid,
                  author: comment.author,
                })
              }
              className="mt-2 font-serif-cn text-[13px] tracking-[1px] text-muted transition-opacity hover:opacity-70"
              aria-label={`回复 ${comment.author}`}
            >
              回复
            </button>
          ) : null}

          {activeReplyCoid === comment.coid ? <div className="mt-5">{replyForm}</div> : null}

          {comment.children.map((child) => (
            <CommentItem
              key={child.coid}
              comment={child}
              depth={Math.min(depth + 1, 2)}
              onReply={onReply}
              canReply={canReply}
              activeReplyCoid={activeReplyCoid}
              replyForm={replyForm}
            />
          ))}
        </div>
      </div>
    </article>
  );
}

export function CommentList({
  comments,
  onReply,
  canReply = true,
  activeReplyCoid = null,
  replyForm,
}: CommentListProps) {
  if (comments.length === 0) {
    return (
      <p className="mori-stagger-item pt-8 font-sans text-sm leading-8 text-secondary">
        暂无评论，来做第一个写下想法的人。
      </p>
    );
  }

  return (
    <section className="w-full">
      {comments.map((comment, index) => (
        <div key={comment.coid} className="mori-stagger-item" style={{ animationDelay: `${index * 46}ms` }}>
          <CommentItem
            comment={comment}
            depth={0}
            onReply={onReply}
            canReply={canReply}
            activeReplyCoid={activeReplyCoid}
            replyForm={replyForm}
          />
        </div>
      ))}
    </section>
  );
}
