import { notFound } from "next/navigation";

import { ColumnInfoCard } from "@/components/column-info-card";
import { Shell } from "@/components/shell";
import { buildNavItems } from "@/lib/navigation";
import { buildTocFallback, getPostDetailData, getSiteContext } from "@/lib/site-data";
import { PostBody } from "@/components/article/post-body";
import { PostHero } from "@/components/article/post-hero";
import { ColumnDirectory } from "@/components/article/column-directory";
import { TableOfContents } from "@/components/article/table-of-contents";
import { MobileTocSheet } from "@/components/article/mobile-toc-sheet";
import { PostNavigation } from "@/components/article/post-navigation";
import { CommentSection } from "@/components/article/comment-section";

export const dynamic = "force-dynamic";

interface PostPageProps {
  params: Promise<{
    slug: string;
  }>;
  searchParams: Promise<{
    cpage?: string;
  }>;
}

function parseCommentPage(value?: string) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export default async function PostPage({ params, searchParams }: PostPageProps) {
  const { slug } = await params;
  const commentPage = parseCommentPage((await searchParams).cpage);

  const context = await getSiteContext();
  const navItems = buildNavItems(context);

  if (!context.configured) {
    return (
      <Shell context={context} navItems={navItems} mobileArticleMode>
        <main className="mx-auto w-full max-w-[1440px] px-5 pb-10 md:px-0" />
      </Shell>
    );
  }

  const detail = await getPostDetailData(slug, commentPage).catch(() => null);
  if (!detail) {
    notFound();
  }

  const tocItems = detail.tocItems.length > 0 ? detail.tocItems : buildTocFallback(detail.post.title);

  return (
    <Shell context={context} navItems={navItems} mobileArticleMode>
      <main className="mx-auto w-full max-w-[1440px] px-5 pb-10 md:px-0">
        <section className="flex flex-col gap-8 py-6 md:gap-10 md:py-[100px]">
          <PostHero post={detail.post} readCount={detail.readCount} likeCount={detail.likeCount} />

          <section className="min-[1440px]:mx-auto min-[1440px]:grid min-[1440px]:max-w-[1440px] min-[1440px]:grid-cols-[200px_850px_200px] min-[1440px]:gap-x-[95px]">
            <aside className="hidden min-[1440px]:block">
              <div className="sticky top-24">
                <ColumnDirectory
                  column={detail.column}
                  currentSlug={detail.post.slug}
                  articles={detail.columnArticles}
                />
              </div>
            </aside>

            <div className="mx-auto w-full max-w-[850px]">
              <PostBody post={detail.post} />
            </div>

            <aside className="hidden min-[1440px]:block">
              <div className="sticky top-24">
                <TableOfContents items={tocItems} />
              </div>
            </aside>
          </section>

          <section className="mx-auto w-full max-w-[850px] min-[1440px]:ml-[295px]">
            <div className="flex flex-col gap-5 md:gap-6">
              <ColumnInfoCard column={detail.column} />
              <PostNavigation prev={detail.adjacent.prev} next={detail.adjacent.next} />
            </div>
          </section>

          {detail.post.commentValue !== 0 ? (
            <section className="mx-auto w-full max-w-[850px] min-[1440px]:ml-[295px]">
              <CommentSection
                slug={detail.post.slug}
                comments={detail.comments}
                disableForm={detail.post.commentValue === 2}
                pagination={detail.commentsPagination}
              />
            </section>
          ) : null}
        </section>
      </main>

      <MobileTocSheet items={tocItems} />
    </Shell>
  );
}
