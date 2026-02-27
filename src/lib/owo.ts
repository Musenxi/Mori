const OWO_TOKEN_REGEX = /::([^:\r\n/\\]+):([^:\r\n/\\]+)::/g;
export const OWO_IMAGE_EXTENSIONS = [".avif", ".webp", ".png", ".jpg", ".jpeg", ".gif"] as const;
const OWO_EXTENSION_PRIORITY: Record<string, number> = {
  ".avif": 0,
  ".webp": 1,
  ".png": 2,
  ".jpg": 3,
  ".jpeg": 4,
  ".gif": 5,
};

export interface OwoCatalogItem {
  path: string;
  src: string;
  label: string;
  token: string;
}

export interface OwoCatalogGroup {
  id: string;
  label: string;
  items: OwoCatalogItem[];
}

function hasControlChar(value: string) {
  return /[\u0000-\u001F\u007F]/.test(value);
}

function getFileNameFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function getFileExtension(fileName: string) {
  const value = getFileNameFromPath(fileName);
  const index = value.lastIndexOf(".");
  if (index <= 0) {
    return "";
  }
  return value.slice(index).toLowerCase();
}

function getFileStem(fileName: string) {
  const value = getFileNameFromPath(fileName);
  const index = value.lastIndexOf(".");
  if (index <= 0) {
    return value;
  }
  return value.slice(0, index);
}

function stripRetinaSuffix(stem: string) {
  return stem.replace(/_2x$/i, "");
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function encodeUrlPathSegments(pathValue: string) {
  return pathValue
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function decodeHexLabel(input: string) {
  const normalized = input.trim();
  if (normalized.length < 4 || normalized.length % 2 !== 0 || !/^(?:[0-9a-f]{2})+$/i.test(normalized)) {
    return "";
  }

  try {
    const bytes = new Uint8Array(
      normalized.match(/.{2}/g)?.map((chunk) => Number.parseInt(chunk, 16)) ?? [],
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
  } catch {
    return "";
  }
}

function normalizeLabel(label: string) {
  const compacted = label.replace(/[_-]+/g, " ").trim();
  return compacted || "表情";
}

function scoreOwoAsset(fileName: string) {
  const extension = getFileExtension(fileName);
  const priority = OWO_EXTENSION_PRIORITY[extension] ?? 99;
  const retinaPenalty = /_2x(?=\.[^.]+$)/i.test(fileName) ? 10 : 0;
  return priority * 100 + retinaPenalty;
}

function canonicalAssetKey(fileName: string) {
  return stripRetinaSuffix(getFileStem(fileName).toLowerCase());
}

export function getOwoTokenName(fileNameOrPath: string) {
  return stripRetinaSuffix(getFileStem(fileNameOrPath));
}

export function normalizeOwoIdentifier(rawValue: string) {
  const normalized = rawValue.trim();
  if (!normalized) {
    return null;
  }
  if (normalized === "." || normalized === ".." || normalized.includes("..")) {
    return null;
  }
  if (normalized.includes("/") || normalized.includes("\\") || normalized.includes(":")) {
    return null;
  }
  if (hasControlChar(normalized)) {
    return null;
  }
  return normalized;
}

export function normalizeOwoAssetPath(rawPath: string) {
  const normalized = rawPath.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
  if (!normalized) {
    return null;
  }
  if (normalized.includes("..") || hasControlChar(normalized)) {
    return null;
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }

  const extension = getFileExtension(normalized);
  if (!(OWO_IMAGE_EXTENSIONS as readonly string[]).includes(extension)) {
    return null;
  }

  return normalized;
}

export function isOwoImageFile(fileName: string) {
  return (OWO_IMAGE_EXTENSIONS as readonly string[]).includes(getFileExtension(fileName));
}

export function buildOwoToken(groupRaw: string, nameRaw: string) {
  const group = normalizeOwoIdentifier(groupRaw);
  const name = normalizeOwoIdentifier(nameRaw);
  if (!group || !name) {
    return "";
  }
  return `::${group}:${name}::`;
}

export function getOwoDisplayName(fileNameOrPath: string) {
  const stem = getOwoTokenName(fileNameOrPath);
  const decoded = decodeHexLabel(stem);
  if (decoded) {
    return decoded;
  }
  return normalizeLabel(stem);
}

export function pickPreferredOwoFiles(fileNames: string[]) {
  const selected = new Map<string, string>();

  for (const fileName of fileNames) {
    if (!isOwoImageFile(fileName)) {
      continue;
    }

    const key = canonicalAssetKey(fileName);
    const current = selected.get(key);
    if (!current || scoreOwoAsset(fileName) < scoreOwoAsset(current)) {
      selected.set(key, fileName);
    }
  }

  return [...selected.values()].sort((a, b) => {
    const leftLabel = getOwoDisplayName(a);
    const rightLabel = getOwoDisplayName(b);
    const labelCompare = leftLabel.localeCompare(rightLabel, "zh-Hans-CN");
    if (labelCompare !== 0) {
      return labelCompare;
    }
    return a.localeCompare(b);
  });
}

export function buildOwoAssetResolverPath(groupRaw: string, nameRaw: string) {
  const group = normalizeOwoIdentifier(groupRaw);
  const name = normalizeOwoIdentifier(nameRaw);
  if (!group || !name) {
    return "";
  }
  return `/api/owo/asset/${encodeURIComponent(group)}/${encodeURIComponent(name)}`;
}

export function toOwoPublicSrc(rawPath: string) {
  const normalized = normalizeOwoAssetPath(rawPath);
  if (!normalized) {
    return "";
  }

  return `/owo/${encodeUrlPathSegments(normalized)}`;
}

export function getOwoAssetCandidates(groupRaw: string, nameRaw: string) {
  const group = normalizeOwoIdentifier(groupRaw);
  const name = normalizeOwoIdentifier(nameRaw);
  if (!group || !name) {
    return [];
  }

  const candidates: string[] = [];

  for (const extension of OWO_IMAGE_EXTENSIONS) {
    const standardPath = normalizeOwoAssetPath(`${group}/${name}${extension}`);
    if (standardPath) {
      candidates.push(standardPath);
    }

    const retinaPath = normalizeOwoAssetPath(`${group}/${name}_2x${extension}`);
    if (retinaPath) {
      candidates.push(retinaPath);
    }
  }

  return candidates;
}

export function replaceOwoTokensWithHtml(input: string) {
  if (!input || !input.includes("::")) {
    return input;
  }

  return input.replace(OWO_TOKEN_REGEX, (full, groupRaw: string, nameRaw: string) => {
    const group = normalizeOwoIdentifier(groupRaw);
    const name = normalizeOwoIdentifier(nameRaw);
    if (!group || !name) {
      return full;
    }

    const src = buildOwoAssetResolverPath(group, name);
    if (!src) {
      return full;
    }

    const label = escapeHtmlAttribute(getOwoDisplayName(name));
    return `<img src="${escapeHtmlAttribute(src)}" alt="${label}" class="mori-owo" />`;
  });
}
