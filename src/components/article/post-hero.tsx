import Image from "next/image";

import { NormalizedPost } from "@/lib/typecho-types";

interface PostHeroProps {
  post: NormalizedPost & { coverImage?: string };
  readCount: string;
  likeCount: string;
  wordCount: number;
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
          <span>{readCount}</span>
        </MetaItem>
        <MetaItem
          icon={
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 21H6a2 2 0 0 1-2-2v-7h4v9Z" />
              <path d="M10 21h6.2a2 2 0 0 0 1.94-1.53l1.56-6.2A2 2 0 0 0 17.76 11H14V7.8a2.8 2.8 0 0 0-2.8-2.8L10 9v12Z" />
            </svg>
          }
        >
          <span>{likeCount}</span>
        </MetaItem>
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
