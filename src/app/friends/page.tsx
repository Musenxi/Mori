import { Suspense } from "react";

import "../article-content-critical.css";
import { StaticPageContentFallback } from "@/components/page-loading-fallbacks";
import { StaticPageContent } from "@/components/static-page-view";
import { getStaticPageDetailBySlug } from "@/lib/site-data";

export const revalidate = 60;

async function FriendsPageContent() {
  const detail = await getStaticPageDetailBySlug("friends", 1);

  return (
    <StaticPageContent
      fallbackTitle="友人"
      page={detail?.page ?? null}
      comments={detail?.comments ?? []}
      commentsPagination={detail?.commentsPagination}
    />
  );
}

export default async function FriendsPage() {
  return (
    <Suspense fallback={<StaticPageContentFallback />}>
      <FriendsPageContent />
    </Suspense>
  );
}
