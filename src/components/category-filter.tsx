import Link from "next/link";

import { ColumnInfo } from "@/lib/site-data";
import { cn } from "@/lib/cn";

interface CategoryFilterProps {
  categories: ColumnInfo[];
  activeSlug: string | null;
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center rounded-full px-4 py-1.5 font-sans text-sm transition-colors",
        active ? "bg-primary text-bg" : "bg-tag text-secondary hover:bg-hover",
      )}
    >
      {label}
    </Link>
  );
}

export function CategoryFilter({ categories, activeSlug }: CategoryFilterProps) {
  return (
    <div className="flex flex-wrap gap-3">
      <FilterChip href="/category" active={!activeSlug} label="全部" />
      {categories.map((category) => (
        <FilterChip
          key={category.slug}
          href={`/category?slug=${encodeURIComponent(category.slug)}`}
          active={activeSlug === category.slug}
          label={category.name}
        />
      ))}
    </div>
  );
}
