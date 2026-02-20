import { PostCard } from "@/components/post-card";
import { YearGroupedPosts } from "@/lib/typecho-types";

interface YearPostGroupsProps {
  groups: YearGroupedPosts[];
}

export function YearPostGroups({ groups }: YearPostGroupsProps) {
  return (
    <section className="flex flex-col gap-[60px]">
      {groups.map((group) => (
        <article key={group.year} className="relative">
          <div className="pointer-events-none absolute left-0 top-0 font-sans text-[100px] font-black leading-[0.9] text-primary/12 md:text-[120px]">
            {group.year.split("").join("\n")}
          </div>

          <div className="pl-[43px] md:pl-[63px]">
            {group.posts.map((post) => (
              <PostCard key={post.cid} post={post} compact />
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}
