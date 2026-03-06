import { notFound } from "next/navigation";
import { Suspense } from "react";

import "maplibre-gl/dist/maplibre-gl.css";
import "../../article-content-critical.css";
import { ColumnInfoCard } from "@/components/column-info-card";
import { PostContentFallback } from "@/components/page-loading-fallbacks";
import { getPostDetailData } from "@/lib/site-data";
import { getPosts, isTypechoConfigured } from "@/lib/typecho-client";
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
import { DesktopSideNavigationDrawer } from "@/components/article/desktop-side-navigation-drawer";
import { FootprintFloatingMap } from "@/components/article/footprint-floating-map";
import { getBlurhashDataUrlForSource } from "@/lib/blurhash-placeholder";

export const revalidate = 60;

interface PostPageProps {
  params: Promise<{
    slug: string;
  }>;
}

function resolvePostOrigin(permalink?: string) {
  const rawPermalink = typeof permalink === "string" ? permalink.trim() : "";
  if (rawPermalink) {
    try {
      return new URL(rawPermalink).origin;
    } catch {
      // Fall back below.
    }
  }

  const fallbackOrigin =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.SITE_URL?.trim() ||
    "http://127.0.0.1:3000";

  try {
    return new URL(fallbackOrigin).origin;
  } catch {
    return "http://127.0.0.1:3000";
  }
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
  const coverBlurDataUrl = await getBlurhashDataUrlForSource(
    detail.post.coverImage?.trim() || "",
    resolvePostOrigin(detail.post.permalink),
  );

  const tocItems = detail.tocItems;
  const desktopMapEnabled = detail.map.enabled && detail.map.points.length > 0;
  const articleLayoutClass = desktopMapEnabled
    ? "min-[1080px]:max-[1279px]:mx-auto min-[1080px]:max-[1279px]:grid min-[1080px]:max-[1279px]:max-w-[1098px] min-[1080px]:max-[1279px]:grid-cols-[minmax(0,850px)_200px] min-[1080px]:max-[1279px]:gap-x-12 min-[1280px]:max-[1439px]:mx-auto min-[1280px]:max-[1439px]:grid min-[1280px]:max-[1439px]:max-w-[1140px] min-[1280px]:max-[1439px]:grid-cols-[minmax(0,780px)_320px] min-[1280px]:max-[1439px]:gap-x-10 min-[1280px]:pl-[18px] min-[1440px]:mx-auto min-[1440px]:grid min-[1440px]:max-w-[1140px] min-[1440px]:grid-cols-[minmax(0,780px)_320px] min-[1440px]:gap-x-10 min-[1440px]:pl-[18px]"
    : "min-[1080px]:max-[1439px]:mx-auto min-[1080px]:max-[1439px]:grid min-[1080px]:max-[1439px]:max-w-[1098px] min-[1080px]:max-[1439px]:grid-cols-[minmax(0,850px)_200px] min-[1080px]:max-[1439px]:gap-x-12 min-[1440px]:mx-auto min-[1440px]:grid min-[1440px]:max-w-[1440px] min-[1440px]:grid-cols-[180px_850px_200px] min-[1440px]:gap-x-[95px]";

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
              coverBlurDataUrl={coverBlurDataUrl}
            />
          </div>

          {desktopMapEnabled ? (
            <DesktopSideNavigationDrawer
              posts={detail.sideNavigationPosts}
              currentCid={detail.post.cid}
              column={detail.column}
              currentSlug={detail.post.slug}
              articles={detail.columnArticles}
            />
          ) : null}

          <section className={articleLayoutClass}>
            {!desktopMapEnabled ? (
              <aside
                data-side-nav-scroll-container
                className="mori-post-left-rail mori-post-rail-stagger mori-stagger-item group hidden min-[1440px]:sticky min-[1440px]:top-24 min-[1440px]:z-40 min-[1440px]:block min-[1440px]:w-[180px] min-[1440px]:max-h-[calc(100vh-7rem)] min-[1440px]:self-start min-[1440px]:justify-self-end min-[1440px]:overflow-y-auto min-[1440px]:pr-1"
                style={{ animationDelay: "120ms" }}
              >
                <div className="opacity-30 transition-opacity duration-300 group-hover:opacity-100">
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
                </div>
              </aside>
            ) : null}

            <div className={`mx-auto flex w-full flex-col gap-8 ${desktopMapEnabled ? "max-w-[850px] min-[1280px]:max-w-[780px]" : "max-w-[850px]"}`}>
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
              data-mori-toc-rail
              className={`mori-post-right-rail mori-post-rail-stagger mori-stagger-item hidden min-[1080px]:sticky min-[1080px]:top-24 min-[1080px]:block min-[1080px]:self-start min-[1080px]:pr-1 ${desktopMapEnabled ? "min-[1080px]:overflow-visible min-[1080px]:w-[200px] min-[1080px]:ml-[100px] min-[1280px]:w-[320px]" : "min-[1080px]:max-h-[calc(100vh-7rem)] min-[1080px]:overflow-y-auto min-[1080px]:w-[200px]"}`}
              style={{ animationDelay: "170ms" }}
            >
              {desktopMapEnabled ? (
                <div className="flex h-[calc(100vh-7rem)] min-h-0 flex-col">
                  <TableOfContents items={tocItems} className="h-full max-h-[500px] min-h-0 max-w-full flex-1" />
                  <FootprintFloatingMap points={detail.map.points} routes={detail.map.routes} />
                </div>
              ) : (
                <TableOfContents items={tocItems} />
              )}
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

  return (
    <Suspense fallback={<PostContentFallback />}>
      <PostPageContent slug={slug} configured={isTypechoConfigured()} />
    </Suspense>
  );
}
