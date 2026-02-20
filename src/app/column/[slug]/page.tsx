import { notFound } from "next/navigation";

import { ColumnInfoCard } from "@/components/column-info-card";
import { Shell } from "@/components/shell";
import { YearPostGroups } from "@/components/year-post-groups";
import { buildNavItems } from "@/lib/navigation";
import { getColumnDetailData, getSiteContext } from "@/lib/site-data";

export const dynamic = "force-dynamic";

interface ColumnDetailPageProps {
  params: Promise<{
    slug: string;
  }>;
}

export default async function ColumnDetailPage({ params }: ColumnDetailPageProps) {
  const { slug } = await params;

  const context = await getSiteContext();
  const navItems = buildNavItems(context);

  if (!context.configured) {
    return (
      <Shell context={context} navItems={navItems}>
        <main className="mx-auto w-full max-w-[1440px] px-5 py-10 md:px-[300px] md:py-[80px]" />
      </Shell>
    );
  }

  const data = await getColumnDetailData(slug).catch(() => null);
  if (!data) {
    notFound();
  }

  return (
    <Shell context={context} navItems={navItems}>
      <main className="mx-auto w-full max-w-[1440px] px-5 py-10 md:px-[300px] md:py-[80px]">
        <section className="flex flex-col gap-8 md:gap-[60px]">
          <ColumnInfoCard column={data.column} hideAction />
          <div className="h-px w-full bg-border" />

          {data.groups.length > 0 ? (
            <YearPostGroups groups={data.groups} />
          ) : (
            <p className="font-sans text-sm leading-8 text-secondary">该专栏暂无文章。</p>
          )}
        </section>
      </main>
    </Shell>
  );
}
