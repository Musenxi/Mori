import { Suspense } from "react";

import { CategoryPageClient } from "@/components/category-page-client";
import { CategoryContentFallback } from "@/components/page-loading-fallbacks";
import { getCategoryPageData } from "@/lib/site-data";
import { isTypechoConfigured } from "@/lib/typecho-client";

export const revalidate = 86400;

async function CategoryPageContent({
  configured,
}: {
  configured: boolean;
}) {
  const data = configured
    ? await getCategoryPageData(null).catch(() => ({
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
        initialActiveSlug={null}
        posts={data.posts}
      />
    </section>
  );
}

export default async function CategoryPage() {
  return (
    <main className="mx-auto w-full max-w-[1440px] px-5 pb-[20px] md:px-0">
      <Suspense fallback={<CategoryContentFallback />}>
        <CategoryPageContent configured={isTypechoConfigured()} />
      </Suspense>
    </main>
  );
}
