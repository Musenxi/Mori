import { Suspense } from "react";

import { CategoryPageClient } from "@/components/category-page-client";
import { CategoryContentFallback } from "@/components/page-loading-fallbacks";
import { getCategoryPageData, getSiteContext } from "@/lib/site-data";

export const revalidate = 86400;

interface CategoryPageProps {
  searchParams: Promise<{
    slug?: string;
  }>;
}

async function CategoryPageContent({
  activeSlug,
  configured,
}: {
  activeSlug: string | null;
  configured: boolean;
}) {
  const data = configured
    ? await getCategoryPageData(activeSlug).catch(() => ({
      categories: [],
      posts: [],
      groups: [],
    }))
    : { categories: [], posts: [], groups: [] };

  return (
    <section className="flex flex-col gap-12 py-10 md:gap-[60px] md:px-[80px] md:py-[80px] md:pl-[clamp(20px,calc(40vw-280px),300px)]">
      <CategoryPageClient
        initialCategories={data.categories}
        initialGroups={data.groups}
        initialActiveSlug={activeSlug}
        posts={data.posts}
      />
    </section>
  );
}

export default async function CategoryPage({ searchParams }: CategoryPageProps) {
  const params = await searchParams;
  const activeSlug = params.slug?.trim() || null;

  const context = await getSiteContext();
  return (
    <main className="mx-auto w-full max-w-[1440px] px-5 pb-[20px] md:px-0">
      <Suspense fallback={<CategoryContentFallback />}>
        <CategoryPageContent activeSlug={activeSlug} configured={context.configured} />
      </Suspense>
    </main>
  );
}
