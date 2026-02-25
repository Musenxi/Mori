import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex h-full min-h-[50vh] flex-col items-center justify-center bg-bg px-6 py-20 text-center">
      <p className="font-sans text-sm tracking-[2px] text-muted">404</p>
      <h1 className="mt-4 font-serif-cn text-3xl tracking-[4px] text-primary">页面不存在</h1>
      <p className="mt-3 font-sans text-sm leading-7 text-secondary">你访问的内容可能已移动或被删除。</p>
      <Link
        href="/"
        className="mt-8 inline-flex rounded-full bg-primary px-6 py-2 font-serif-cn text-sm tracking-[2px] text-bg"
      >
        返回首页
      </Link>
    </main>
  );
}
