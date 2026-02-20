"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface ReplyTarget {
  coid: number;
  author: string;
}

interface CommentFormProps {
  slug: string;
  replyTarget?: ReplyTarget | null;
  onCancelReply?: () => void;
  onSubmitted?: () => void;
}

interface FormState {
  author: string;
  mail: string;
  url: string;
  text: string;
}

const INITIAL_FORM: FormState = {
  author: "",
  mail: "",
  url: "",
  text: "",
};

export function CommentForm({ slug, replyTarget = null, onCancelReply, onSubmitted }: CommentFormProps) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string>("");

  const canSubmit = useMemo(() => {
    return Boolean(form.author.trim() && form.mail.trim() && form.text.trim() && !submitting);
  }, [form.author, form.mail, form.text, submitting]);

  useEffect(() => {
    if (!replyTarget) {
      return;
    }

    textareaRef.current?.focus();
  }, [replyTarget]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setSubmitting(true);
    setFeedback("");

    try {
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          slug,
          parent: replyTarget?.coid,
          author: form.author.trim(),
          mail: form.mail.trim(),
          url: form.url.trim(),
          text: form.text.trim(),
        }),
      });

      const result = (await response.json()) as {
        ok: boolean;
        message?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(result.message || "评论提交失败，请稍后重试。");
      }

      setFeedback("评论已提交，感谢你的分享。若开启审核，管理员通过后会展示。");
      setForm(INITIAL_FORM);
      onSubmitted?.();
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "评论提交失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="w-full" onSubmit={onSubmit}>
      <h2 className="font-serif-cn text-[22px] tracking-[2px] text-primary">{replyTarget ? "回复" : "评论"}</h2>

      {replyTarget ? (
        <div className="comment-border mt-4 flex items-center justify-between rounded-md border bg-tag px-3 py-2">
          <p className="font-sans text-sm text-secondary">
            正在回复：<span className="font-medium text-primary">{replyTarget.author}</span>
          </p>
          <button
            type="button"
            onClick={onCancelReply}
            className="font-sans text-xs text-muted transition-opacity hover:opacity-70"
          >
            取消回复
          </button>
        </div>
      ) : null}

      <div className="mt-8 grid gap-4 md:grid-cols-3 md:gap-6">
        <label className="comment-border flex h-[30px] items-center border px-[10px]">
          <input
            required
            value={form.author}
            onChange={(event) => setForm((prev) => ({ ...prev, author: event.target.value }))}
            placeholder="昵称 *"
            className="w-full border-none bg-transparent font-sans text-sm text-primary placeholder:text-muted focus:outline-none"
          />
        </label>

        <label className="comment-border flex h-[30px] items-center border px-[10px]">
          <input
            required
            type="email"
            value={form.mail}
            onChange={(event) => setForm((prev) => ({ ...prev, mail: event.target.value }))}
            placeholder="邮箱 *"
            className="w-full border-none bg-transparent font-sans text-sm text-primary placeholder:text-muted focus:outline-none"
          />
        </label>

        <label className="comment-border flex h-[30px] items-center border px-[10px]">
          <input
            value={form.url}
            onChange={(event) => setForm((prev) => ({ ...prev, url: event.target.value }))}
            placeholder="网站"
            className="w-full border-none bg-transparent font-sans text-sm text-primary placeholder:text-muted focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-8">
        <label className="comment-border block border p-5">
          <textarea
            ref={textareaRef}
            required
            value={form.text}
            onChange={(event) => setForm((prev) => ({ ...prev, text: event.target.value }))}
            placeholder="写下你的想法..."
            className="h-28 w-full resize-none border-none bg-transparent font-sans text-sm leading-7 text-primary placeholder:text-muted focus:outline-none"
          />
        </label>

        <div className="flex items-center justify-between pt-3">
          <button
            type="button"
            className="comment-border rounded-2xl border px-4 py-1.5 font-sans text-sm tracking-[1px] text-secondary"
          >
            OωO
          </button>

          <button
            disabled={!canSubmit}
            type="submit"
            className="rounded-[20px] bg-primary px-8 py-2.5 font-serif-cn text-sm tracking-[2px] text-bg transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "提交中..." : replyTarget ? "发表回复" : "发表评论"}
          </button>
        </div>
      </div>

      {feedback ? <p className="mt-4 font-sans text-sm text-secondary">{feedback}</p> : null}
    </form>
  );
}
