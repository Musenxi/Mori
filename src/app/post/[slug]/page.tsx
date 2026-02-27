import { notFound } from "next/navigation";
import { Suspense } from "react";

import "../../article-content-critical.css";
import { ColumnInfoCard } from "@/components/column-info-card";
import { PostContentFallback } from "@/components/page-loading-fallbacks";
import { getPostDetailData, getSiteContext } from "@/lib/site-data";
import { getPosts } from "@/lib/typecho-client";
import { ArticleContentDeferredStyles } from "@/components/article/article-content-deferred-styles";
import { PostBody } from "@/components/article/post-body";
import { PostHero } from "@/components/article/post-hero";
import { ColumnDirectory } from "@/components/article/column-directory";
import { TableOfContents } from "@/components/article/table-of-contents";
import { MobileTocSheet } from "@/components/article/mobile-toc-sheet";
import { PostNavigation } from "@/components/article/post-navigation";
import { CommentSection } from "@/components/article/comment-section";
import { SidePostNavigation } from "@/components/article/side-post-navigation";
import { TocActions } from "@/components/article/toc-actions";

export const revalidate = 60;

interface PostPageProps {
  params: Promise<{
    slug: string;
  }>;
}

export async function generateStaticParams() {
  try {
    const result = await getPosts({
      page: 1,
      pageSize: 240,
      showDigest: "excerpt",
      showContent: false,
      limit: 240,
      revalidate: 300,
    });

    return result.dataSet
      .map((post) => String(post.slug || "").trim())
      .filter((slug) => slug.length > 0)
      .map((slug) => ({ slug }));
  } catch {
    return [] as Array<{ slug: string }>;
  }
}

async function PostPageContent({ slug, configured }: { slug: string; configured: boolean }) {
  const commentPage = 1;

  if (!configured) {
    return (
      <main className="mx-auto w-full max-w-[1440px] px-5 pb-[20px] md:px-0" />
    );
  }

  const detail = await getPostDetailData(slug, commentPage).catch(() => null);
  if (!detail) {
    notFound();
  }

  const tocItems = detail.tocItems;

  return (
    <>
      <ArticleContentDeferredStyles />
      <main className="mx-auto w-full max-w-[1440px] px-5 pb-[20px] md:px-0">
        <section className="flex flex-col gap-8 pt-6 pb-[20px] md:gap-10 md:pt-[100px] md:pb-[20px]">
          <div className="mori-stagger-item">
            <PostHero
              post={detail.post}
              readCount={detail.readCount}
              likeCount={detail.likeCount}
              wordCount={detail.wordCount}
            />
          </div>

          <section className="min-[1440px]:mx-auto min-[1440px]:grid min-[1440px]:max-w-[1440px] min-[1440px]:grid-cols-[180px_850px_200px] min-[1440px]:gap-x-[95px]">
            <aside
              data-side-nav-scroll-container
              className="mori-post-left-rail mori-stagger-item hidden min-[1440px]:sticky min-[1440px]:top-24 min-[1440px]:block min-[1440px]:w-[180px] min-[1440px]:max-h-[calc(100vh-7rem)] min-[1440px]:self-start min-[1440px]:justify-self-end min-[1440px]:overflow-y-auto min-[1440px]:pr-1"
              style={{ animationDelay: "120ms" }}
            >
              <SidePostNavigation
                posts={detail.sideNavigationPosts}
                currentCid={detail.post.cid}
                className={detail.column ? "mb-8" : undefined}
              />
              {detail.column ? (
                <ColumnDirectory
                  column={detail.column}
                  currentSlug={detail.post.slug}
                  articles={detail.columnArticles}
                />
              ) : null}
            </aside>

            <div className="mx-auto w-full max-w-[850px] flex flex-col gap-8">
              <div className="mori-stagger-item" style={{ animationDelay: "90ms" }}>
                <PostBody post={detail.post} />
              </div>

              <section className="mori-stagger-item flex flex-col gap-5 md:gap-6" style={{ animationDelay: "140ms" }}>
                {detail.column ? <ColumnInfoCard column={detail.column} /> : null}
                <div className="min-[1440px]:hidden">
                  <PostNavigation prev={detail.adjacent.prev} next={detail.adjacent.next} nextFirst />
                </div>
              </section>

              {detail.post.commentValue !== 0 ? (
                <section className="mori-stagger-item" style={{ animationDelay: "190ms" }}>
                  <Suspense fallback={null}>
                    <CommentSection
                      slug={detail.post.slug}
                      comments={detail.comments}
                      disableForm={detail.post.commentValue === 2}
                      pagination={detail.commentsPagination}
                    />
                  </Suspense>
                </section>
              ) : null}
            </div>

            <aside
              className="mori-post-right-rail mori-stagger-item hidden min-[1440px]:sticky min-[1440px]:top-24 min-[1440px]:block min-[1440px]:w-[200px] min-[1440px]:max-h-[calc(100vh-7rem)] min-[1440px]:self-start min-[1440px]:overflow-y-auto min-[1440px]:pr-1"
              style={{ animationDelay: "170ms" }}
            >
              <TableOfContents items={tocItems} />
            </aside>
          </section>
        </section>
      </main>

      <MobileTocSheet items={tocItems} />
      <TocActions
        cid={detail.post.cid}
        slug={detail.post.slug}
        initialLikeCount={detail.likeCount}
      />
    </>
  );
}

export default async function PostPage({ params }: PostPageProps) {
  const { slug } = await params;
  const context = await getSiteContext();

  return (
    <Suspense fallback={<PostContentFallback />}>
      <PostPageContent slug={slug} configured={context.configured} />
    </Suspense>
  );
}
