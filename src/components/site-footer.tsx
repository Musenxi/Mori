interface SiteFooterProps {
  blogTitle: string;
}

export function SiteFooter({ blogTitle }: SiteFooterProps) {
  const year = new Date().getFullYear();

  return (
    <footer className="flex h-[100px] items-center justify-center px-5 md:px-20">
      <p className="font-sans text-[11px] font-light tracking-[0.5px] text-primary/60">
        © 2019-{year} {blogTitle}
      </p>
    </footer>
  );
}
