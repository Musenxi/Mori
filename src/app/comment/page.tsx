import { Suspense } from "react";

import "../article-content-critical.css";
import { StaticPageContentFallback } from "@/components/page-loading-fallbacks";
import { StaticPageContent } from "@/components/static-page-view";
import { getStaticPageDetailBySlug } from "@/lib/site-data";

export const revalidate = 60;

async function CommentPageContent() {
  const detail = await getStaticPageDetailBySlug("comment", 1);

  return (
    <StaticPageContent
      fallbackTitle="留言"
      page={detail?.page ?? null}
      comments={detail?.comments ?? []}
      commentsPagination={detail?.commentsPagination}
    />
  );
}

export default async function CommentPage() {
  return (
    <Suspense fallback={<StaticPageContentFallback />}>
      <CommentPageContent />
    </Suspense>
  );
}
