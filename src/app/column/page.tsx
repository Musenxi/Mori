import Link from "next/link";

import { ColumnCard } from "@/components/column-card";
import { Shell } from "@/components/shell";
import { buildNavItems } from "@/lib/navigation";
import { getColumnsData, getSiteContext } from "@/lib/site-data";

export const dynamic = "force-dynamic";

export default async function ColumnPage() {
  const context = await getSiteContext();
  const navItems = buildNavItems(context);

  const columns = context.configured ? await getColumnsData().catch(() => []) : [];

  return (
    <Shell context={context} navItems={navItems}>
      <main className="mx-auto w-full max-w-[1440px] px-5 pb-8 md:px-0">
        <section className="flex flex-col gap-8 py-10 md:gap-[60px] md:px-[80px] md:py-[80px] md:pl-[clamp(20px,calc(40vw-280px),300px)]">
          <header className="mori-stagger-item flex items-center gap-5 md:gap-8">
            <h1 className="font-serif-cn text-[32px] font-bold leading-[1.4] tracking-[4px] text-primary md:text-[36px] md:tracking-[6px]">
              专栏
            </h1>
            <Link
              href="/category"
              className="font-serif-cn text-lg text-muted transition-opacity hover:opacity-70 md:text-xl"
            >
              分类
            </Link>
          </header>

          {columns.length > 0 ? (
            <div className="flex flex-col gap-4 md:gap-6">
              {columns.map((column, index) => (
                <div
                  key={column.slug}
                  className="mori-stagger-item"
                  style={{ animationDelay: `${90 + index * 52}ms` }}
                >
                  <ColumnCard
                    column={column}
                    compact={false}
                    href={`/column/${encodeURIComponent(column.slug)}`}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="mori-stagger-item font-sans text-sm leading-8 text-secondary" style={{ animationDelay: "90ms" }}>
              暂无专栏数据。
            </p>
          )}
        </section>
      </main>
    </Shell>
  );
}
