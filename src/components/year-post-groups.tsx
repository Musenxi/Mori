import { PostCard } from "@/components/post-card";
import { YearGroupedPosts } from "@/lib/typecho-types";

interface YearPostGroupsProps {
  groups: YearGroupedPosts[];
  staggered?: boolean;
  animationToken?: number | string;
  staggerStepMs?: number;
}

export function YearPostGroups({
  groups,
  staggered = false,
  animationToken = "static",
  staggerStepMs = 48,
}: YearPostGroupsProps) {
  let order = 0;

  return (
    <section className="flex flex-col gap-[60px]">
      {groups.map((group) => (
        <article key={group.year} className="relative">
          <div className="pointer-events-none absolute left-0 top-0 font-sans text-[100px] font-black leading-[0.9] text-primary/12 md:text-[120px]">
            {group.year.split("").join("\n")}
          </div>

          <div className="pl-[43px] md:pl-[63px]">
            {group.posts.map((post) => {
              const index = order++;

              if (!staggered) {
                return <PostCard key={post.cid} post={post} compact />;
              }

              return (
                <div
                  key={`${animationToken}-${post.cid}`}
                  className="mori-stagger-item"
                  style={{ animationDelay: `${index * staggerStepMs}ms` }}
                >
                  <PostCard post={post} compact />
                </div>
              );
            })}
          </div>
        </article>
      ))}
    </section>
  );
}
