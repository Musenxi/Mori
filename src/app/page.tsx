import { Suspense } from "react";

import { HomeContentFallback } from "@/components/page-loading-fallbacks";
import { Shell } from "@/components/shell";
import { YearPostGroups } from "@/components/year-post-groups";
import { buildNavItems } from "@/lib/navigation";
import { getHomeData, getSiteContext } from "@/lib/site-data";

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
  const context = await getSiteContext();
  const navItems = buildNavItems(context);

  return (
    <Shell context={context} navItems={navItems}>
      <main className="mx-auto w-full max-w-[1440px] px-5 pb-8 md:px-0">
        <Suspense fallback={<HomeContentFallback />}>
          <HomePageContent />
        </Suspense>
      </main>
    </Shell>
  );
}
