"use client";

import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import type { OwoCatalogGroup } from "@/lib/owo";

export interface ReplyTarget {
  coid: number;
  author: string;
}

interface CommentFormProps {
  slug: string;
  replyTarget?: ReplyTarget | null;
  onCancelReply?: () => void;
  onSubmitted?: (payload: { status?: string; message: string }) => void | Promise<void>;
}

interface FormState {
  author: string;
  mail: string;
  url: string;
  text: string;
}

interface OwoListResponse {
  ok: boolean;
  message?: string;
  data?: {
    groups: OwoCatalogGroup[];
  };
}

function buildOwoTokenFromAssetPath(assetPath: string) {
  const normalized = assetPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) {
    return "";
  }

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length < 2) {
    return "";
  }

  const group = segments[0]?.trim() ?? "";
  const fileName = segments[segments.length - 1]?.trim() ?? "";
  const stem = fileName.replace(/\.[^.]+$/, "").replace(/_2x$/i, "").trim();
  const invalidGroup = !group || group.includes(":") || group.includes("/") || group.includes("\\") || group.includes("..");
  const invalidStem = !stem || stem.includes(":") || stem.includes("/") || stem.includes("\\") || stem.includes("..");
  if (invalidGroup || invalidStem) {
    return "";
  }

  return `::${group}:${stem}::`;
}

function buildSubmitSuccessMessage(status?: string) {
  if (status?.toLowerCase() === "waiting") {
    return "评论提交成功，待审核后展示。";
  }

  return "评论提交成功。";
}

const INITIAL_FORM: FormState = {
  author: "",
  mail: "",
  url: "",
  text: "",
};

export function CommentForm({ slug, replyTarget = null, onCancelReply, onSubmitted }: CommentFormProps) {
  const formId = useId().replace(/:/g, "");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const owoTriggerRef = useRef<HTMLButtonElement | null>(null);
  const owoPanelRef = useRef<HTMLDivElement | null>(null);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string>("");
  const [showOwoPanel, setShowOwoPanel] = useState(false);
  const [loadingOwo, setLoadingOwo] = useState(false);
  const [owoFeedback, setOwoFeedback] = useState("");
  const [owoGroups, setOwoGroups] = useState<OwoCatalogGroup[]>([]);
  const [activeOwoGroupId, setActiveOwoGroupId] = useState("");

  const authorId = `comment-${formId}-author`;
  const mailId = `comment-${formId}-mail`;
  const urlId = `comment-${formId}-url`;
  const textId = `comment-${formId}-text`;
  const owoPanelId = `comment-${formId}-owo-panel`;

  const canSubmit = useMemo(() => {
    return Boolean(form.author.trim() && form.mail.trim() && form.text.trim() && !submitting);
  }, [form.author, form.mail, form.text, submitting]);
  const activeOwoGroup = useMemo(() => {
    return owoGroups.find((group) => group.id === activeOwoGroupId) ?? owoGroups[0];
  }, [activeOwoGroupId, owoGroups]);
  const activeOwoItems = activeOwoGroup?.items ?? [];

  useEffect(() => {
    if (!replyTarget) {
      return;
    }

    textareaRef.current?.focus();
  }, [replyTarget]);

  useEffect(() => {
    if (!showOwoPanel) {
      return;
    }

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (owoPanelRef.current?.contains(target) || owoTriggerRef.current?.contains(target)) {
        return;
      }

      setShowOwoPanel(false);
    };

    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [showOwoPanel]);

  const loadOwo = useCallback(async () => {
    if (loadingOwo || owoGroups.length > 0) {
      return;
    }

    setLoadingOwo(true);
    setOwoFeedback("");

    try {
      const response = await fetch("/api/owo?v=2", {
        method: "GET",
        cache: "no-store",
      });
      const result = (await response.json()) as OwoListResponse;

      if (!response.ok || !result.ok || !result.data) {
        throw new Error(result.message || "表情加载失败，请稍后重试。");
      }

      const groups = result.data.groups.filter((group) => group.items.length > 0);
      setOwoGroups(groups);
      setActiveOwoGroupId((current) => {
        if (current && groups.some((group) => group.id === current)) {
          return current;
        }
        return groups[0]?.id ?? "";
      });

      if (groups.length === 0) {
        setOwoFeedback("暂无可用表情。");
      }
    } catch (error) {
      setOwoFeedback(error instanceof Error ? error.message : "表情加载失败，请稍后重试。");
    } finally {
      setLoadingOwo(false);
    }
  }, [loadingOwo, owoGroups.length]);

  const insertTokenAtCursor = useCallback((token: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setForm((prev) => ({ ...prev, text: `${prev.text}${token}` }));
      return;
    }

    const selectionStart = textarea.selectionStart ?? textarea.value.length;
    const selectionEnd = textarea.selectionEnd ?? textarea.value.length;
    const nextCursor = selectionStart + token.length;

    setForm((prev) => {
      const start = Math.max(0, Math.min(selectionStart, prev.text.length));
      const end = Math.max(start, Math.min(selectionEnd, prev.text.length));
      const nextText = `${prev.text.slice(0, start)}${token}${prev.text.slice(end)}`;
      return { ...prev, text: nextText };
    });

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  }, []);

  const insertOwo = useCallback((token: string) => {
    insertTokenAtCursor(token);
    setShowOwoPanel(false);
  }, [insertTokenAtCursor]);

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
        data?: {
          status?: string;
        };
      };

      if (!response.ok || !result.ok) {
        throw new Error(result.message || "评论提交失败，请稍后重试。");
      }

      const successMessage = buildSubmitSuccessMessage(result.data?.status);
      setForm(INITIAL_FORM);
      setShowOwoPanel(false);

      if (onSubmitted) {
        try {
          await onSubmitted({ status: result.data?.status, message: successMessage });
        } catch {
          // The comment has already been submitted successfully. Keep success feedback.
        }
      } else {
        setFeedback(successMessage);
      }
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
        <label htmlFor={authorId} className="comment-border flex h-[30px] items-center border px-[10px]">
          <input
            id={authorId}
            name="author"
            autoComplete="name"
            required
            value={form.author}
            onChange={(event) => setForm((prev) => ({ ...prev, author: event.target.value }))}
            placeholder="昵称 *"
            className="w-full border-none bg-transparent font-sans text-sm text-primary placeholder:text-muted focus:outline-none"
          />
        </label>

        <label htmlFor={mailId} className="comment-border flex h-[30px] items-center border px-[10px]">
          <input
            id={mailId}
            name="email"
            autoComplete="email"
            required
            type="email"
            value={form.mail}
            onChange={(event) => setForm((prev) => ({ ...prev, mail: event.target.value }))}
            placeholder="邮箱 *"
            className="w-full border-none bg-transparent font-sans text-sm text-primary placeholder:text-muted focus:outline-none"
          />
        </label>

        <label htmlFor={urlId} className="comment-border flex h-[30px] items-center border px-[10px]">
          <input
            id={urlId}
            name="url"
            autoComplete="url"
            value={form.url}
            onChange={(event) => setForm((prev) => ({ ...prev, url: event.target.value }))}
            placeholder="网站"
            className="w-full border-none bg-transparent font-sans text-sm text-primary placeholder:text-muted focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-8">
        <label htmlFor={textId} className="comment-border block border p-5">
          <textarea
            id={textId}
            name="text"
            ref={textareaRef}
            required
            value={form.text}
            onChange={(event) => setForm((prev) => ({ ...prev, text: event.target.value }))}
            placeholder="写下你的想法..."
            className="h-28 w-full resize-none border-none bg-transparent font-sans text-sm leading-7 text-primary placeholder:text-muted focus:outline-none"
          />
        </label>

        <div className="flex items-center justify-between pt-3">
          <div className="relative">
            <button
              ref={owoTriggerRef}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={showOwoPanel}
              aria-controls={owoPanelId}
              onClick={() => {
                if (showOwoPanel) {
                  setShowOwoPanel(false);
                  return;
                }

                setShowOwoPanel(true);
                void loadOwo();
              }}
              className="comment-border rounded-2xl border px-4 py-1.5 font-sans text-sm tracking-[1px] text-secondary transition-colors hover:bg-hover"
            >
              OωO
            </button>

            {showOwoPanel ? (
              <div
                id={owoPanelId}
                ref={owoPanelRef}
                className="comment-border absolute top-[calc(100%+10px)] left-0 z-20 w-[min(92vw,420px)] overflow-hidden rounded-md border bg-bg shadow-[0_14px_40px_rgba(0,0,0,0.12)]"
              >
                {owoGroups.length > 0 ? (
                  <div className="comment-border flex items-center gap-1 overflow-x-auto border-b px-2 py-2">
                    {owoGroups.map((group) => (
                      <button
                        type="button"
                        key={group.id}
                        onClick={() => setActiveOwoGroupId(group.id)}
                        className={cn(
                          "shrink-0 rounded-full px-3 py-1 font-sans text-xs tracking-[0.5px] transition-colors",
                          activeOwoGroup?.id === group.id ? "bg-primary text-bg" : "text-secondary hover:bg-hover",
                        )}
                      >
                        {group.label}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="max-h-64 overflow-y-auto p-2">
                  {loadingOwo ? (
                    <p className="py-6 text-center font-sans text-sm text-muted">加载表情中...</p>
                  ) : owoFeedback ? (
                    <p className="py-6 text-center font-sans text-sm text-secondary">{owoFeedback}</p>
                  ) : activeOwoItems.length > 0 ? (
                    <div className="grid grid-cols-5 gap-2">
                      {activeOwoItems.map((item) => (
                        <button
                          key={item.path}
                          type="button"
                          title={item.label}
                          aria-label={`插入表情 ${item.label}`}
                          onClick={() => {
                            const token = buildOwoTokenFromAssetPath(item.path);
                            if (!token) {
                              return;
                            }
                            insertOwo(token);
                          }}
                          className="flex h-[4.4em] w-[4.4em] items-center justify-center rounded-md transition-colors hover:bg-hover"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={item.src}
                            alt={item.label}
                            loading="lazy"
                            className="h-[4em] w-[4em] object-contain"
                          />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="py-6 text-center font-sans text-sm text-secondary">暂无可用表情。</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>

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
