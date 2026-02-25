import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ColumnDetailClient } from "@/components/column-detail-client";
import { ColumnDetailContentFallback } from "@/components/page-loading-fallbacks";
import { getColumnDetailData, getColumnsData, getSiteContext } from "@/lib/site-data";

export const revalidate = 60;

interface ColumnDetailPageProps {
  params: Promise<{
    slug: string;
  }>;
}

async function ColumnDetailContent({
  slug,
  configured,
}: {
  slug: string;
  configured: boolean;
}) {
  if (!configured) {
    return null;
  }

  const [data, columns] = await Promise.all([
    getColumnDetailData(slug).catch(() => null),
    getColumnsData().catch(() => []),
  ]);

  if (!data) {
    notFound();
  }

  return (
    <ColumnDetailClient
      columns={columns}
      initialSlug={slug}
      initialColumn={data.column}
      initialGroups={data.groups}
    />
  );
}

export default async function ColumnDetailPage({ params }: ColumnDetailPageProps) {
  const { slug } = await params;
  const context = await getSiteContext();

  return (
    <main className="mx-auto w-full max-w-[1440px] px-5 py-10 md:px-[80px] md:py-[80px] md:pl-[clamp(20px,calc(40vw-280px),300px)]">
      <Suspense fallback={<ColumnDetailContentFallback />}>
        <ColumnDetailContent slug={slug} configured={context.configured} />
      </Suspense>
    </main>
  );
}
