export type ResolvedColumnIcon =
  | { type: "image"; src: string }
  | { type: "text"; text: string };

function isLikelyBase64Svg(raw: string) {
  if (raw.length < 80) {
    return false;
  }
  return /^[A-Za-z0-9+/=\r\n]+$/.test(raw);
}

export function resolveColumnIcon(icon?: string): ResolvedColumnIcon | null {
  const raw = (icon || "").trim();
  if (!raw) {
    return null;
  }

  if (/^https?:\/\//i.test(raw) || raw.startsWith("//") || raw.startsWith("/")) {
    return { type: "image", src: raw };
  }

  if (/^data:image\//i.test(raw)) {
    return { type: "image", src: raw };
  }

  if (raw.startsWith("<svg")) {
    return {
      type: "image",
      src: `data:image/svg+xml;utf8,${encodeURIComponent(raw)}`,
    };
  }

  if (/^base64:/i.test(raw)) {
    const payload = raw.replace(/^base64:/i, "").trim();
    if (payload) {
      return { type: "image", src: `data:image/svg+xml;base64,${payload}` };
    }
  }

  if (/^base64,/i.test(raw)) {
    const payload = raw.replace(/^base64,/i, "").trim();
    if (payload) {
      return { type: "image", src: `data:image/svg+xml;base64,${payload}` };
    }
  }

  if (isLikelyBase64Svg(raw)) {
    return { type: "image", src: `data:image/svg+xml;base64,${raw}` };
  }

  return { type: "text", text: raw };
}
