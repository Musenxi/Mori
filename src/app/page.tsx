import { Suspense } from "react";

import { HomeContentFallback } from "@/components/page-loading-fallbacks";
import { YearPostGroups } from "@/components/year-post-groups";
import { getHomeData } from "@/lib/site-data";

export const revalidate = 60;

async function HomePageContent() {
  const home = await getHomeData();

  return (
    <section className="mori-stagger-item px-0 py-8 md:px-[80px] md:py-[50px] md:pl-[clamp(20px,calc(40vw-280px),300px)]">
      {home.groups.length > 0 ? (
        <YearPostGroups groups={home.groups} staggered />
      ) : (
        <p className="font-sans text-sm leading-8 text-secondary">暂无文章，请先在 Typecho 后台发布内容。</p>
      )}
    </section>
  );
}

export default async function HomePage() {
  return (
    <main className="mx-auto w-full max-w-[1440px] px-5 pb-[20px] md:px-0">
      <Suspense fallback={<HomeContentFallback />}>
        <HomePageContent />
      </Suspense>
    </main>
  );
}
