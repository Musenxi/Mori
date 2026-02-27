const NEXT_IMAGE_API_PATH = "/_next/image";
const NON_OPTIMIZABLE_SCHEME_REGEX = /^(?:data:|blob:|javascript:|about:)/i;
const ABSOLUTE_HTTP_URL_REGEX = /^https?:\/\//i;
const ROOT_RELATIVE_URL_REGEX = /^\//;
const PROTOCOL_RELATIVE_URL_REGEX = /^\/\//;
const NEXT_ALLOWED_WIDTHS = [640, 750, 828, 1080, 1200, 1600, 1920, 2048, 3840] as const;

function normalizeImageSrc(input?: string | null) {
  const source = typeof input === "string" ? input.trim() : "";
  if (!source) {
    return "";
  }
  return source;
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeNextWidth(value: number) {
  const requested = clampInteger(value, NEXT_ALLOWED_WIDTHS[0], NEXT_ALLOWED_WIDTHS[NEXT_ALLOWED_WIDTHS.length - 1]);
  const matched = NEXT_ALLOWED_WIDTHS.find((width) => width >= requested);
  return matched ?? NEXT_ALLOWED_WIDTHS[NEXT_ALLOWED_WIDTHS.length - 1];
}

function normalizeProxyTarget(source: string) {
  if (PROTOCOL_RELATIVE_URL_REGEX.test(source)) {
    return `https:${source}`;
  }

  return source;
}

export function toNextImageProxySrc(input?: string | null, options?: { width?: number; quality?: number }) {
  const source = normalizeImageSrc(input);
  if (!source) {
    return "";
  }
  if (NON_OPTIMIZABLE_SCHEME_REGEX.test(source)) {
    return source;
  }

  if (source.startsWith(`${NEXT_IMAGE_API_PATH}?`)) {
    return source;
  }

  const target = normalizeProxyTarget(source);
  if (!ABSOLUTE_HTTP_URL_REGEX.test(target) && !ROOT_RELATIVE_URL_REGEX.test(target)) {
    return source;
  }

  const width = normalizeNextWidth(options?.width ?? 1600);
  const quality = clampInteger(options?.quality ?? 75, 1, 100);
  const params = new URLSearchParams({
    url: target,
    w: String(width),
    q: String(quality),
  });
  return `${NEXT_IMAGE_API_PATH}?${params.toString()}`;
}
