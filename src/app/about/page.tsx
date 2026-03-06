import { Suspense } from "react";

import "../article-content-critical.css";
import { StaticPageContentFallback } from "@/components/page-loading-fallbacks";
import { StaticPageContent } from "@/components/static-page-view";
import { getStaticPageDetailBySlug } from "@/lib/site-data";

export const revalidate = 60;

async function AboutPageContent() {
  const detail = await getStaticPageDetailBySlug("about", 1);

  return (
    <StaticPageContent
      fallbackTitle="关于"
      page={detail?.page ?? null}
      comments={detail?.comments ?? []}
      commentsPagination={detail?.commentsPagination}
    />
  );
}

export default async function AboutPage() {
  return (
    <Suspense fallback={<StaticPageContentFallback />}>
      <AboutPageContent />
    </Suspense>
  );
}
