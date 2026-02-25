import { Suspense } from "react";

import "../article-content-critical.css";
import { StaticPageContentFallback } from "@/components/page-loading-fallbacks";
import { StaticPageContent } from "@/components/static-page-view";
import { getSiteContext, getStaticPageDetailBySlug } from "@/lib/site-data";

export const revalidate = 60;

interface CommentPageProps {
  searchParams: Promise<{
    cpage?: string;
  }>;
}

function parseCommentPage(value?: string) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

async function CommentPageContent({
  configured,
  commentPage,
}: {
  configured: boolean;
  commentPage: number;
}) {
  const detail = configured ? await getStaticPageDetailBySlug("comment", commentPage) : null;

  return (
    <StaticPageContent
      fallbackTitle="留言"
      page={detail?.page ?? null}
      comments={detail?.comments ?? []}
      commentsPagination={detail?.commentsPagination}
    />
  );
}

export default async function CommentPage({ searchParams }: CommentPageProps) {
  const commentPage = parseCommentPage((await searchParams).cpage);
  const context = await getSiteContext();

  return (
    <Suspense fallback={<StaticPageContentFallback />}>
      <CommentPageContent configured={context.configured} commentPage={commentPage} />
    </Suspense>
  );
}
