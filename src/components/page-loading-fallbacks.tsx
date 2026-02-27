import { cn } from "@/lib/cn";

function PulseBlock({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-border/45", className)} />;
}

function PulseTextRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, index) => (
        <PulseBlock
          key={index}
          className={cn("h-4", index === rows - 1 ? "w-1/3" : "w-full")}
        />
      ))}
    </div>
  );
}

function YearGroupSkeleton() {
  return (
    <div className="flex flex-col gap-[60px]">
      {Array.from({ length: 2 }).map((_, yearIndex) => (
        <article key={yearIndex} className="relative">
          <PulseBlock className="absolute left-0 top-0 h-[120px] w-[30px] md:h-[150px] md:w-[40px]" />
          <div className="space-y-4 pl-[43px] md:pl-[63px]">
            {Array.from({ length: 4 }).map((__, postIndex) => (
              <div key={postIndex} className="rounded-[16px] border border-border px-4 py-4 md:px-6">
                <PulseBlock className="h-5 w-2/3" />
                <PulseBlock className="mt-3 h-4 w-1/3" />
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

export function HomeContentFallback() {
  return (
    <section className="px-0 py-8 md:px-[80px] md:py-[50px] md:pl-[clamp(20px,calc(40vw-280px),300px)]">
      <YearGroupSkeleton />
    </section>
  );
}

export function CategoryContentFallback() {
  return (
    <section className="flex flex-col gap-12 py-10 md:gap-[60px] md:px-[80px] md:py-[80px] md:pl-[clamp(20px,calc(40vw-280px),300px)]">
      <header className="flex flex-col gap-8 md:gap-14">
        <PulseBlock className="h-10 w-28" />
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <PulseBlock key={index} className="h-9 w-20 rounded-full" />
          ))}
        </div>
      </header>
      <YearGroupSkeleton />
    </section>
  );
}

export function ColumnListContentFallback() {
  return (
    <section className="flex flex-col gap-8 py-10 md:gap-[60px] md:px-[80px] md:py-[80px] md:pl-[clamp(20px,calc(40vw-280px),300px)]">
      <PulseBlock className="h-10 w-24" />
      <div className="space-y-4 md:space-y-6">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="rounded-[18px] border border-border px-5 py-5 md:px-7 md:py-6">
            <PulseBlock className="h-6 w-40" />
            <PulseBlock className="mt-3 h-4 w-28" />
            <PulseBlock className="mt-5 h-4 w-11/12" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function ColumnDetailContentFallback() {
  return (
    <section className="flex flex-col gap-8 md:gap-[60px]">
      <header className="flex flex-col gap-8 md:gap-14">
        <PulseBlock className="h-10 w-24" />
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <PulseBlock key={index} className="h-9 w-24 rounded-full" />
          ))}
        </div>
      </header>
      <div className="rounded-[18px] border border-border px-5 py-6 md:px-7">
        <PulseBlock className="h-7 w-1/3" />
        <PulseBlock className="mt-4 h-4 w-1/4" />
        <PulseTextRows rows={3} />
      </div>
      <PulseBlock className="h-px w-full rounded-none" />
      <YearGroupSkeleton />
    </section>
  );
}

export function StaticPageContentFallback() {
  return (
    <main className="mx-auto w-full max-w-[1440px] px-5 pb-[20px] md:px-0">
      <section className="mx-auto max-w-[850px] pt-10 pb-[20px] md:pt-[100px] md:pb-[20px]">
        <PulseBlock className="h-12 w-56" />
        <PulseBlock className="mt-8 h-px w-full rounded-none" />
        <div className="mt-8 space-y-4">
          <PulseTextRows rows={9} />
        </div>
      </section>
    </main>
  );
}

export function PostContentFallback() {
  return (
    <main className="mx-auto w-full max-w-[1440px] px-5 pb-[20px] md:px-0">
      <section className="flex flex-col gap-8 pt-6 pb-[20px] md:gap-10 md:pt-[100px] md:pb-[20px]">
        <section className="mx-auto flex w-full max-w-[1104px] flex-col items-center gap-6 pt-10 md:pt-10">
          <PulseBlock className="h-12 w-3/4 max-w-[850px]" />
          <PulseBlock className="h-4 w-72" />
          <PulseBlock className="h-[245px] w-full md:h-[460px]" />
        </section>

        <section className="min-[1280px]:mx-auto min-[1280px]:grid min-[1280px]:max-w-[1440px] min-[1280px]:grid-cols-[180px_minmax(0,1fr)_180px] min-[1280px]:gap-x-8 min-[1440px]:grid-cols-[180px_850px_200px] min-[1440px]:gap-x-[95px]">
          <aside className="hidden min-[1280px]:block">
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <PulseBlock key={index} className="h-6 w-full" />
              ))}
            </div>
          </aside>

          <div className="mx-auto w-full max-w-[850px] flex flex-col gap-8">
            <div className="space-y-4">
              <PulseTextRows rows={14} />
            </div>
            <div className="space-y-3">
              <PulseBlock className="h-5 w-40" />
              <PulseTextRows rows={4} />
            </div>
          </div>

          <aside className="hidden min-[1280px]:block">
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <PulseBlock key={index} className="h-6 w-full" />
              ))}
            </div>
          </aside>
        </section>
      </section>
    </main>
  );
}
