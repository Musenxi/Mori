"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { TocItem } from "@/lib/typecho-types";
import { TableOfContents } from "@/components/article/table-of-contents";

interface MobileTocSheetProps {
  items: TocItem[];
}

export function MobileTocSheet({ items }: MobileTocSheetProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const openHandler = () => setOpen(true);
    window.addEventListener("mori:open-toc", openHandler);
    return () => window.removeEventListener("mori:open-toc", openHandler);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const esc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 bg-black/40 transition-opacity md:hidden",
        open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
      )}
      onClick={() => setOpen(false)}
      aria-hidden={!open}
    >
      <section
        className={cn(
          "absolute inset-x-0 bottom-0 rounded-t-[20px] bg-bg transition-transform duration-200",
          open ? "translate-y-0" : "translate-y-full",
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex justify-center px-6 pt-3 pb-2">
          <span className="h-1 w-10 rounded bg-border" aria-hidden />
        </div>

        <div className="flex items-center justify-between px-6 pb-4">
          <h2 className="font-serif-cn text-lg font-medium tracking-[2px] text-primary">目录</h2>
          <button
            type="button"
            className="font-serif-cn text-sm tracking-[1px] text-secondary"
            onClick={() => setOpen(false)}
          >
            收起
          </button>
        </div>

        <div className="h-px w-full bg-border" />

        <TableOfContents
          items={items}
          className="max-h-[60vh] overflow-y-auto px-6 py-4"
          onItemClick={() => setOpen(false)}
          scrollInNextTick
        />

        <div className="h-6" />
      </section>
    </div>
  );
}
