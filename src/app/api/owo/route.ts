import { readdir } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

import {
  buildOwoToken,
  getOwoDisplayName,
  getOwoTokenName,
  normalizeOwoAssetPath,
  pickPreferredOwoFiles,
  toOwoPublicSrc,
} from "@/lib/owo";
import type { OwoCatalogGroup, OwoCatalogItem } from "@/lib/owo";

const OWO_ROOT = path.join(process.cwd(), "public", "owo");
const OWO_GROUP_LABELS: Record<string, string> = {
  quyin: "蛆音娘",
  reci: "阿B热词系列",
};

function resolveOwoGroupLabel(groupId: string) {
  return OWO_GROUP_LABELS[groupId] ?? groupId;
}

function toReadCachedJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}

function toNoStoreJson(payload: unknown, status = 500) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}

async function loadGroupItems(groupId: string): Promise<OwoCatalogItem[]> {
  const groupPath = path.join(OWO_ROOT, groupId);
  const entries = await readdir(groupPath, { withFileTypes: true });
  const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const selectedFiles = pickPreferredOwoFiles(fileNames);

  return selectedFiles
    .map((fileName) => {
      const normalizedPath = normalizeOwoAssetPath(`${groupId}/${fileName}`);
      if (!normalizedPath) {
        return null;
      }

      const tokenName = getOwoTokenName(fileName);
      const token = buildOwoToken(groupId, tokenName);
      if (!token) {
        return null;
      }

      const src = toOwoPublicSrc(normalizedPath);
      if (!src) {
        return null;
      }

      return {
        path: normalizedPath,
        src,
        label: getOwoDisplayName(fileName),
        token,
      } satisfies OwoCatalogItem;
    })
    .filter((item): item is OwoCatalogItem => Boolean(item));
}

async function loadOwoGroups(): Promise<OwoCatalogGroup[]> {
  const entries = await readdir(OWO_ROOT, { withFileTypes: true });
  const groupIds = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

  const groups = await Promise.all(
    groupIds.map(async (groupId) => {
      const items = await loadGroupItems(groupId);
      if (items.length === 0) {
        return null;
      }

      return {
        id: groupId,
        label: resolveOwoGroupLabel(groupId),
        items,
      } satisfies OwoCatalogGroup;
    }),
  );

  return groups.filter((group): group is OwoCatalogGroup => Boolean(group));
}

export async function GET() {
  try {
    const groups = await loadOwoGroups();
    return toReadCachedJson({
      ok: true,
      data: {
        groups,
      },
    });
  } catch {
    return toNoStoreJson({
      ok: false,
      message: "表情列表加载失败，请稍后重试。",
      data: {
        groups: [],
      },
    });
  }
}
