import { CategoryPageClient } from "@/components/category-page-client";
import { Shell } from "@/components/shell";
import { buildNavItems } from "@/lib/navigation";
import { getCategoryData, getSiteContext } from "@/lib/site-data";

export const dynamic = "force-dynamic";

interface CategoryPageProps {
  searchParams: Promise<{
    slug?: string;
  }>;
}

export default async function CategoryPage({ searchParams }: CategoryPageProps) {
  const params = await searchParams;
  const activeSlug = params.slug?.trim() || null;

  const context = await getSiteContext();
  const navItems = buildNavItems(context);

  const data = context.configured
    ? await getCategoryData(activeSlug).catch(() => ({ categories: [], groups: [] }))
    : { categories: [], groups: [] };

  return (
    <Shell context={context} navItems={navItems}>
      <main className="mx-auto w-full max-w-[1440px] px-5 pb-8 md:px-0">
        <section className="flex flex-col gap-12 py-10 md:gap-[60px] md:px-[80px] md:py-[80px] md:pl-[300px]">
          <CategoryPageClient
            initialCategories={data.categories}
            initialGroups={data.groups}
            initialActiveSlug={activeSlug}
          />
        </section>
      </main>
    </Shell>
  );
}
