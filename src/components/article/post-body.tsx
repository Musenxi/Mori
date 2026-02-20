import { NormalizedPost } from "@/lib/typecho-types";

interface PostBodyProps {
  post: NormalizedPost & { html: string };
}

export function PostBody({ post }: PostBodyProps) {
  return (
    <article className="flex w-full flex-col items-center gap-6">
      <div className="prose-article w-full" dangerouslySetInnerHTML={{ __html: post.html }} />

      {post.tags.length > 0 ? (
        <div className="flex w-full flex-wrap gap-3 pt-2">
          {post.tags.map((tag) => (
            <span
              key={tag.slug || tag.name}
              className="inline-flex rounded-[15px] bg-tag px-4 py-1.5 font-sans text-[13px] text-secondary"
            >
              #{tag.name}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}
