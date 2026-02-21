import Link from "next/link";

import { NormalizedPost } from "@/lib/typecho-types";

interface PostNavigationProps {
  prev?: NormalizedPost;
  next?: NormalizedPost;
  nextFirst?: boolean;
}

function NavBlock({ label, post }: { label: string; post?: NormalizedPost }) {
  if (!post) {
    return null;
  }

  return (
    <>
      <div className="h-px w-full bg-border" />
      <Link href={`/post/${post.slug}`} className="block py-5">
        <p className="font-sans text-xs text-muted">{label}</p>
        <p className="mt-1 font-sans text-[15px] text-primary">{post.title}</p>
      </Link>
    </>
  );
}

export function PostNavigation({ prev, next, nextFirst = false }: PostNavigationProps) {
  if (!prev && !next) {
    return null;
  }

  return (
    <section className="w-full">
      {nextFirst ? (
        <>
          <NavBlock label="下一篇" post={next} />
          <NavBlock label="上一篇" post={prev} />
        </>
      ) : (
        <>
          <NavBlock label="上一篇" post={prev} />
          <NavBlock label="下一篇" post={next} />
        </>
      )}
      <div className="h-px w-full bg-border" />
    </section>
  );
}
