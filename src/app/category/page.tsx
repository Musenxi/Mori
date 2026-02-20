import { CategoryFilter } from "@/components/category-filter";
import { Shell } from "@/components/shell";
import { YearPostGroups } from "@/components/year-post-groups";
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
        <section className="flex flex-col gap-12 py-10 md:gap-[60px] md:px-[80px] md:py-[80px] md:pl-[400px]">
          <header className="flex flex-col gap-8 md:gap-14">
            <div className="flex items-center gap-5 md:gap-8">
              <h1 className="font-serif-cn text-[32px] font-bold leading-[1.4] tracking-[4px] text-primary md:text-[36px] md:tracking-[6px]">
                分类
              </h1>
              <span className="font-serif-cn text-lg text-muted md:text-xl">专栏</span>
            </div>

            <CategoryFilter categories={data.categories} activeSlug={activeSlug} />
          </header>

          {data.groups.length > 0 ? (
            <YearPostGroups groups={data.groups} />
          ) : (
            <p className="font-sans text-sm leading-8 text-secondary">该分类暂无文章。</p>
          )}
        </section>
      </main>
    </Shell>
  );
}
