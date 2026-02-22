import { notFound } from "next/navigation";

import { ColumnDetailClient } from "@/components/column-detail-client";
import { Shell } from "@/components/shell";
import { buildNavItems } from "@/lib/navigation";
import { getColumnDetailData, getColumnsData, getSiteContext } from "@/lib/site-data";

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
        <main className="mx-auto w-full max-w-[1440px] px-5 py-10 md:px-[80px] md:py-[80px] md:pl-[clamp(20px,calc(40vw-280px),300px)]" />
      </Shell>
    );
  }

  const [data, columns] = await Promise.all([
    getColumnDetailData(slug).catch(() => null),
    getColumnsData().catch(() => []),
  ]);

  if (!data) {
    notFound();
  }

  return (
    <Shell context={context} navItems={navItems}>
      <main className="mx-auto w-full max-w-[1440px] px-5 py-10 md:px-[80px] md:py-[80px] md:pl-[clamp(20px,calc(40vw-280px),300px)]">
        <ColumnDetailClient
          columns={columns}
          initialSlug={slug}
          initialColumn={data.column}
          initialGroups={data.groups}
        />
      </main>
    </Shell>
  );
}
