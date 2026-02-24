import Link from "next/link";

import { ColumnInfo } from "@/lib/site-data";
import { cn } from "@/lib/cn";

interface CategoryFilterProps {
  categories: ColumnInfo[];
  activeSlug: string | null;
  onSelect?: (slug: string | null) => void;
  onPrefetch?: (slug: string | null) => void;
  disabled?: boolean;
}

function FilterChip({
  href,
  active,
  label,
  onClick,
  onPrefetch,
  disabled = false,
}: {
  href: string;
  active: boolean;
  label: string;
  onClick?: () => void;
  onPrefetch?: () => void;
  disabled?: boolean;
}) {
  const className = cn(
    "inline-flex items-center rounded-full px-4 py-1.5 font-sans text-sm transition-colors",
    active ? "bg-primary text-bg" : "bg-tag text-secondary hover:bg-hover",
    disabled && "cursor-not-allowed opacity-60",
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={onPrefetch}
        onFocus={onPrefetch}
        disabled={disabled}
        className={className}
      >
        {label}
      </button>
    );
  }

  return (
    <Link href={href} className={className} onMouseEnter={onPrefetch} onFocus={onPrefetch}>
      {label}
    </Link>
  );
}

export function CategoryFilter({ categories, activeSlug, onSelect, onPrefetch, disabled = false }: CategoryFilterProps) {
  return (
    <div className="flex flex-wrap gap-3">
      <FilterChip
        href="/category"
        active={!activeSlug}
        label="全部"
        onClick={onSelect ? () => onSelect(null) : undefined}
        onPrefetch={onPrefetch ? () => onPrefetch(null) : undefined}
        disabled={disabled}
      />
      {categories.map((category) => (
        <FilterChip
          key={category.slug}
          href={`/category?slug=${encodeURIComponent(category.slug)}`}
          active={activeSlug === category.slug}
          label={category.name}
          onClick={onSelect ? () => onSelect(category.slug) : undefined}
          onPrefetch={onPrefetch ? () => onPrefetch(category.slug) : undefined}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
