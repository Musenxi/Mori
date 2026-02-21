import Image from "next/image";

import { NormalizedPost } from "@/lib/typecho-types";

interface PostHeroProps {
  post: NormalizedPost & { coverImage?: string };
  readCount: string;
  likeCount: string;
  wordCount: number;
}

export function PostHero({ post, readCount, likeCount, wordCount }: PostHeroProps) {
  const src = post.coverImage || "/images/post-placeholder.svg";

  return (
    <section className="mx-auto flex w-full max-w-[1104px] flex-col items-center gap-6 pt-10 md:pt-10">
      <h1 className="w-full max-w-[850px] text-center font-serif-cn text-[32px] leading-[1.4] tracking-[2px] text-primary md:text-[42px]">
        {post.title}
      </h1>

      <div className="flex w-full max-w-[850px] flex-wrap items-center justify-center gap-x-[15px] gap-y-2 font-sans text-sm tracking-[0.5px] text-muted">
        <time>{post.createdLabel}</time>
        <span>{post.categoryName}</span>
        <span>{wordCount}字</span>
        <span>{readCount}</span>
        <span>{likeCount}</span>
      </div>

      <figure className="w-full">
        <Image
          src={src}
          alt={post.title}
          width={1104}
          height={460}
          unoptimized
          className="h-[245px] w-full object-cover md:h-[460px]"
        />
      </figure>
    </section>
  );
}
