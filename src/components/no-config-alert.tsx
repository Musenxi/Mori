export function NoConfigAlert() {
  return (
    <section className="mx-auto my-10 max-w-[960px] rounded-xl border border-border bg-card px-6 py-5">
      <h2 className="font-serif-cn text-xl text-primary">Typecho API 未连接</h2>
      <p className="mt-2 text-sm leading-7 text-secondary">
        请在项目根目录配置 <code className="rounded bg-tag px-1 py-0.5 text-primary">TYPECHO_API_BASE_URL</code>，并确认 Restful
        插件已启用。
      </p>
    </section>
  );
}
