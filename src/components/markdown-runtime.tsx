"use client";

import { decode as decodeBlurhash } from "blurhash";
import { animate } from "motion";
import type { ComponentType } from "react";
import { useEffect } from "react";
import { createRoot, Root } from "react-dom/client";

import "@excalidraw/excalidraw/index.css";

type ExcalidrawInitialData = Record<string, unknown>;
type ExcalidrawAPI = {
  scrollToContent?: (target?: unknown, options?: { fitToContent?: boolean }) => void;
};

type ExcalidrawProps = {
  detectScroll?: boolean;
  initialData?:
  | ExcalidrawInitialData
  | (() => Promise<ExcalidrawInitialData | null> | ExcalidrawInitialData | null);
  theme?: "dark" | "light";
  viewModeEnabled?: boolean;
  zenModeEnabled?: boolean;
  excalidrawAPI?: (api: ExcalidrawAPI) => void;
};
type ExcalidrawComponentType = ComponentType<ExcalidrawProps>;
type MediumZoomInstance = import("medium-zoom").Zoom;

let excalidrawComponentPromise: Promise<ExcalidrawComponentType> | null = null;
const EXCALIDRAW_PORTAL_SELECTOR = ".excalidraw-modal-container";
const excalidrawPortals = new Map<HTMLElement, HTMLElement>();
let excalidrawActiveHost: HTMLElement | null = null;
let excalidrawPortalObserver: MutationObserver | null = null;
const DEFAULT_IMAGE_BLURHASH =
  process.env.NEXT_PUBLIC_IMAGE_BLURHASH?.trim() || "LEHV6nWB2yk8pyo0adR*.7kCMdnj";
let defaultBlurhashDataUrl = "";
const blurhashDataUrlByHash = new Map<string, string>();
const imagePlaceholderDataUrlBySource = new Map<string, string>();
const imagePlaceholderPendingBySource = new Map<string, Promise<string>>();
const BLURHASH_DATA_URL_STORAGE_PREFIX = "mori:blurhash:data-url:v2:";
const BLURHASH_PLACEHOLDER_VERSION = "2";
const BLURHASH_PLACEHOLDER_OPACITY = "1";
const IMAGE_FADE_DURATION_MS = 680;
const IMAGE_REVEAL_DURATION_MS = 900;
const IMAGE_REVEAL_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const IMAGE_REVEAL_BLUR_PX = 10;
const IMAGE_REVEAL_START_OPACITY = 0.6;
const DEFERRED_IMAGE_FADE_START_OPACITY = "0.55";
const DEFERRED_IMAGE_PRELOAD_ROOT_MARGIN = "100% 100% 100% 100%";
const ZOOMABLE_MARKDOWN_IMAGE_SELECTOR = 'img[data-mori-markdown-image="1"]';
const SINGLE_IMAGE_HEIGHT_SELECTOR = [
  '.prose-article > img[data-mori-markdown-image="1"]',
  '.prose-article > .mori-markdown-image-link > img[data-mori-markdown-image="1"]',
  '.prose-article > .mori-image-single > img[data-mori-markdown-image="1"]',
  '.prose-article > .mori-image-single > .mori-markdown-image-link > img[data-mori-markdown-image="1"]',
  '.prose-article p > img[data-mori-markdown-image="1"]:only-child',
  '.prose-article p > .mori-markdown-image-link:only-child > img[data-mori-markdown-image="1"]',
].join(", ");
const SINGLE_IMAGE_AUTO_HEIGHT_MAX_NATURAL_HEIGHT = 420;
const SINGLE_IMAGE_AUTO_HEIGHT_MIN_WIDE_RATIO = 2;
type RevealAnimate = (
  target: Element,
  keyframes: Record<string, unknown>,
  options: { duration?: number; easing?: string | number[] },
) => Animation;
const animateElement = animate as unknown as RevealAnimate;

function isSingleHeightManagedMarkdownImage(image: HTMLImageElement) {
  if (image.closest(".mori-image-gallery")) {
    return false;
  }

  return image.matches(SINGLE_IMAGE_HEIGHT_SELECTOR);
}

function shouldUseAutoHeightForSingleImage(image: HTMLImageElement) {
  if (!isSingleHeightManagedMarkdownImage(image)) {
    return false;
  }

  const deferredSrc = image.getAttribute("data-origin-src")?.trim() || "";
  const currentSrc = image.getAttribute("src")?.trim() || "";
  if (deferredSrc && currentSrc !== deferredSrc) {
    return false;
  }

  const naturalWidth = image.naturalWidth || 0;
  const naturalHeight = image.naturalHeight || 0;
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    return false;
  }

  const aspectRatio = naturalWidth / naturalHeight;
  return (
    naturalHeight <= SINGLE_IMAGE_AUTO_HEIGHT_MAX_NATURAL_HEIGHT ||
    aspectRatio >= SINGLE_IMAGE_AUTO_HEIGHT_MIN_WIDE_RATIO
  );
}

function applySingleImageHeightMode(image: HTMLImageElement) {
  if (!isSingleHeightManagedMarkdownImage(image)) {
    image.classList.remove("mori-image-auto-height");
    return;
  }

  image.classList.toggle("mori-image-auto-height", shouldUseAutoHeightForSingleImage(image));
}

function resolveBlurhashDecodeSize(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 32, height: 32 };
  }

  const maxSize = 32;
  if (width === height) {
    return { width: maxSize, height: maxSize };
  }

  if (width > height) {
    return {
      width: maxSize,
      height: Math.max(1, Math.round((maxSize * height) / width)),
    };
  }

  return {
    width: Math.max(1, Math.round((maxSize * width) / height)),
    height: maxSize,
  };
}

function getBlurhashDataUrlCacheKey(hash: string, width: number, height: number) {
  return `${hash}:${width}x${height}`;
}

function decodeHashToDataUrl(hash: string, width?: number, height?: number) {
  try {
    const output = resolveBlurhashDecodeSize(Number(width), Number(height));
    const pixels = decodeBlurhash(hash, output.width, output.height);
    const canvas = document.createElement("canvas");
    canvas.width = output.width;
    canvas.height = output.height;
    const context = canvas.getContext("2d");
    if (!context) {
      return "";
    }

    const imageData = context.createImageData(output.width, output.height);
    imageData.data.set(pixels);
    context.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

function getDefaultBlurhashDataUrl() {
  if (defaultBlurhashDataUrl) {
    return defaultBlurhashDataUrl;
  }

  defaultBlurhashDataUrl = decodeHashToDataUrl(DEFAULT_IMAGE_BLURHASH);
  return defaultBlurhashDataUrl;
}

function ensureBlurhashImageVersion(image: HTMLImageElement) {
  const rawSrc = image.getAttribute("src")?.trim();
  if (!rawSrc || !rawSrc.includes("/api/blurhash/image")) {
    return;
  }

  try {
    const url = new URL(rawSrc, window.location.origin);
    if (url.searchParams.get("v") === BLURHASH_PLACEHOLDER_VERSION) {
      return;
    }
    url.searchParams.set("v", BLURHASH_PLACEHOLDER_VERSION);
    image.setAttribute("src", url.toString());
  } catch {
    // Ignore malformed urls.
  }
}

function normalizeImageSource(input: string) {
  const source = input.trim();
  if (!source || source.startsWith("data:") || source.startsWith("blob:") || source.startsWith("javascript:")) {
    return "";
  }

  try {
    return new URL(source, window.location.origin).toString();
  } catch {
    return "";
  }
}

function readBlurhashDataUrlFromStorage(source: string) {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const key = `${BLURHASH_DATA_URL_STORAGE_PREFIX}${encodeURIComponent(source)}`;
    const dataUrl = window.localStorage.getItem(key) || "";
    if (!dataUrl.startsWith("data:image/")) {
      return "";
    }
    return dataUrl;
  } catch {
    return "";
  }
}

function writeBlurhashDataUrlToStorage(source: string, dataUrl: string) {
  if (typeof window === "undefined" || !dataUrl.startsWith("data:image/")) {
    return;
  }

  try {
    const key = `${BLURHASH_DATA_URL_STORAGE_PREFIX}${encodeURIComponent(source)}`;
    window.localStorage.setItem(key, dataUrl);
  } catch {
    // Ignore storage quota / privacy mode errors.
  }
}

function getCachedImagePlaceholderDataUrl(inputSource: string) {
  const source = normalizeImageSource(inputSource);
  if (!source) {
    return "";
  }

  if (imagePlaceholderDataUrlBySource.has(source)) {
    return imagePlaceholderDataUrlBySource.get(source) || "";
  }

  const cachedFromStorage = readBlurhashDataUrlFromStorage(source);
  if (cachedFromStorage) {
    imagePlaceholderDataUrlBySource.set(source, cachedFromStorage);
    return cachedFromStorage;
  }

  return "";
}

function parseBlurhashPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const parsed = payload as { ok?: unknown; hash?: unknown; width?: unknown; height?: unknown };
  if (!parsed.ok || typeof parsed.hash !== "string") {
    return null;
  }

  return {
    hash: parsed.hash.trim(),
    width: Number(parsed.width),
    height: Number(parsed.height),
  };
}

async function resolvePerImagePlaceholderDataUrl(inputSource: string) {
  const source = normalizeImageSource(inputSource);
  if (!source) {
    return "";
  }

  if (imagePlaceholderDataUrlBySource.has(source)) {
    return imagePlaceholderDataUrlBySource.get(source) || "";
  }

  const cachedFromStorage = readBlurhashDataUrlFromStorage(source);
  if (cachedFromStorage) {
    imagePlaceholderDataUrlBySource.set(source, cachedFromStorage);
    return cachedFromStorage;
  }

  const pending = imagePlaceholderPendingBySource.get(source);
  if (pending) {
    return pending;
  }

  const job = (async () => {
    try {
      const response = await fetch(`/api/blurhash?src=${encodeURIComponent(source)}`, {
        method: "GET",
        cache: "force-cache",
      });
      if (!response.ok) {
        return "";
      }

      const payload = (await response.json()) as unknown;
      const blurhashPayload = parseBlurhashPayload(payload);
      if (!blurhashPayload?.hash) {
        return "";
      }

      const outputSize = resolveBlurhashDecodeSize(blurhashPayload.width, blurhashPayload.height);
      const cacheKey = getBlurhashDataUrlCacheKey(
        blurhashPayload.hash,
        outputSize.width,
        outputSize.height,
      );
      const cachedDataUrl = blurhashDataUrlByHash.get(cacheKey);
      if (cachedDataUrl) {
        return cachedDataUrl;
      }

      const dataUrl = decodeHashToDataUrl(
        blurhashPayload.hash,
        blurhashPayload.width,
        blurhashPayload.height,
      );
      if (!dataUrl) {
        return "";
      }

      blurhashDataUrlByHash.set(cacheKey, dataUrl);
      return dataUrl;
    } catch {
      return "";
    }
  })()
    .then((dataUrl) => {
      imagePlaceholderDataUrlBySource.set(source, dataUrl);
      if (dataUrl) {
        writeBlurhashDataUrlToStorage(source, dataUrl);
      }
      return dataUrl;
    })
    .finally(() => {
      imagePlaceholderPendingBySource.delete(source);
    });

  imagePlaceholderPendingBySource.set(source, job);
  return job;
}

function decodeBase64Utf8(value: string) {
  try {
    const binary = window.atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

async function copyText(text: string) {
  if (!text) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }
}

function parseJsonObject(raw: string) {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as ExcalidrawInitialData;
    }
  } catch {
    return null;
  }

  return null;
}

async function waitForRenderableSize(node: HTMLElement) {
  const maxAttempts = 12;
  for (let index = 0; index < maxAttempts; index += 1) {
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }
}

async function resolveExcalidrawInitialData(source: string) {
  const nextSource = source.trim();
  if (!nextSource) {
    return null;
  }

  try {
    const requestUrl = (() => {
      if (nextSource.startsWith("/")) {
        return new URL(nextSource, window.location.origin).toString();
      }

      const parsed = new URL(nextSource);
      if (!/^https?:$/i.test(parsed.protocol)) {
        return "";
      }

      return parsed.toString();
    })();

    if (!requestUrl) {
      return null;
    }

    const response = await fetch(requestUrl, {
      cache: "force-cache",
      mode: "cors",
    });
    if (!response.ok) {
      return null;
    }

    const raw = await response.text();
    return parseJsonObject(raw);
  } catch {
    return null;
  }
}

function positionExcalidrawPortal(portal: HTMLElement, host: HTMLElement) {
  const rect = host.getBoundingClientRect();
  portal.style.position = "fixed";
  portal.style.top = `${rect.top}px`;
  portal.style.left = `${rect.left}px`;
  portal.style.width = `${rect.width}px`;
  portal.style.height = `${rect.height}px`;
  portal.style.zIndex = "1000";
}

function assignExcalidrawPortals(host: HTMLElement) {
  const portals = Array.from(
    document.body.querySelectorAll<HTMLElement>(EXCALIDRAW_PORTAL_SELECTOR),
  );

  portals.forEach((portal) => {
    if (!excalidrawPortals.has(portal)) {
      excalidrawPortals.set(portal, host);
    }
    if (excalidrawPortals.get(portal) === host) {
      positionExcalidrawPortal(portal, host);
    }
  });
}

function updateExcalidrawPortals() {
  excalidrawPortals.forEach((host, portal) => {
    if (!document.body.contains(portal)) {
      excalidrawPortals.delete(portal);
      return;
    }
    if (!document.contains(host)) {
      excalidrawPortals.delete(portal);
      return;
    }
    positionExcalidrawPortal(portal, host);
  });
}

async function loadExcalidrawComponent() {
  if (!excalidrawComponentPromise) {
    excalidrawComponentPromise = import("@excalidraw/excalidraw").then((module) => {
      const exported = module as unknown as {
        Excalidraw?: ExcalidrawComponentType;
        default?: ExcalidrawComponentType;
      };
      const Component = exported.Excalidraw ?? exported.default;
      if (!Component) {
        throw new Error("Excalidraw component export not found.");
      }
      return Component;
    });
  }
  return excalidrawComponentPromise;
}

function activateTab(root: HTMLElement, index: string) {
  const allTriggers = root.querySelectorAll<HTMLButtonElement>(".mori-tab-trigger");
  const allPanels = root.querySelectorAll<HTMLElement>(".mori-tab-panel");

  allTriggers.forEach((button) => {
    const active = button.dataset.tabIndex === index;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.setAttribute("tabindex", active ? "0" : "-1");
  });

  allPanels.forEach((panel) => {
    const active = panel.dataset.tabIndex === index;
    panel.classList.toggle("is-active", active);
  });
}

export function MarkdownRuntime() {
  useEffect(() => {
    const excalidrawRoots = new Map<HTMLElement, Root>();
    const excalidrawHostCleanups = new Map<HTMLElement, () => void>();
    const pendingRootUnmounts = new Set<Root>();
    let imageZoom: MediumZoomInstance | null = null;
    let setupImageZoomJob: Promise<void> | null = null;
    const handleImageZoomOpen = (event: Event) => {
      const target = event.target as HTMLImageElement | null;
      if (!target) {
        return;
      }

      target.style.opacity = "1";
      target.style.removeProperty("transition");
    };
    let disposed = false;
    let runtimeStarted = false;
    let startupTimer = 0;
    let pendingLoadListener: (() => void) | null = null;
    const refreshImageZoomTargets = () => {
      if (!imageZoom) {
        return;
      }

      const targets = Array.from(
        document.querySelectorAll<HTMLImageElement>(ZOOMABLE_MARKDOWN_IMAGE_SELECTOR),
      ).filter((image) => !image.hasAttribute("data-nimg"));

      imageZoom.detach();
      imageZoom.attach(targets);
    };
    const setupImageZoom = () => {
      if (imageZoom || setupImageZoomJob) {
        return;
      }

      setupImageZoomJob = import("medium-zoom")
        .then((module) => {
          if (disposed || imageZoom) {
            return;
          }

          imageZoom = module.default({
            background: "rgba(0, 0, 0, 0.9)",
            margin: 24,
            scrollOffset: 0,
          });
          imageZoom.on("open", handleImageZoomOpen);

          refreshImageZoomTargets();
        })
        .catch(() => {
          // Ignore zoom setup failures to avoid blocking runtime features.
        })
        .finally(() => {
          setupImageZoomJob = null;
        });
    };
    const activateDeferredImageSource = (image: HTMLImageElement) => {
      const deferredSrc = image.getAttribute("data-origin-src")?.trim();
      if (!deferredSrc) {
        return false;
      }

      const currentSrc = image.getAttribute("src")?.trim() || "";
      if (currentSrc === deferredSrc) {
        return true;
      }

      image.style.transition = `opacity ${IMAGE_FADE_DURATION_MS}ms ease`;
      image.style.opacity = DEFERRED_IMAGE_FADE_START_OPACITY;
      image.setAttribute("src", deferredSrc);

      const deferredSrcSet = image.getAttribute("data-origin-srcset")?.trim();
      if (deferredSrcSet) {
        image.setAttribute("srcset", deferredSrcSet);
      }

      const deferredSizes = image.getAttribute("data-origin-sizes")?.trim();
      if (deferredSizes) {
        image.setAttribute("sizes", deferredSizes);
      }

      return true;
    };
    const deferredImageObserver =
      typeof window !== "undefined" && "IntersectionObserver" in window
        ? new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) {
                return;
              }

              const image = entry.target as HTMLImageElement;
              deferredImageObserver?.unobserve(image);
              activateDeferredImageSource(image);
            });
          },
          {
            root: null,
            rootMargin: DEFERRED_IMAGE_PRELOAD_ROOT_MARGIN,
            threshold: 0.01,
          },
        )
        : null;

    const enhanceImages = () => {
      if (disposed) {
        return;
      }

      const fallbackBlurhashDataUrl = getDefaultBlurhashDataUrl();
      const images = Array.from(
        document.querySelectorAll<HTMLImageElement>('img[data-mori-markdown-image="1"], img[data-origin-src]'),
      );
      images.forEach((image) => {
        if (image.hasAttribute("data-nimg")) {
          return;
        }

        const originSrc = image.getAttribute("data-origin-src")?.trim() || "";
        if (originSrc) {
          ensureBlurhashImageVersion(image);
        }

        if (image.dataset.moriSingleHeightBound !== "1") {
          image.dataset.moriSingleHeightBound = "1";
          image.addEventListener("load", () => {
            applySingleImageHeightMode(image);
          });
          image.addEventListener("error", () => {
            image.classList.remove("mori-image-auto-height");
          });
        }
        applySingleImageHeightMode(image);

        if (!image.getAttribute("loading")) {
          image.setAttribute("loading", "lazy");
        }
        if (!image.getAttribute("decoding")) {
          image.setAttribute("decoding", "async");
        }

        const currentSrc = image.getAttribute("src")?.trim() || "";
        const zoomSrc = image.getAttribute("data-origin-src")?.trim() || currentSrc;
        if (zoomSrc && zoomSrc !== currentSrc) {
          image.setAttribute("data-zoom-src", zoomSrc);
        } else {
          image.removeAttribute("data-zoom-src");
        }

        if (image.getAttribute("data-origin-src")?.trim()) {
          const deferredCurrentSrc = image.getAttribute("src")?.trim() || "";
          const deferredTargetSrc = image.getAttribute("data-origin-src")?.trim() || "";
          const hasDeferredPending = deferredTargetSrc.length > 0 && deferredCurrentSrc !== deferredTargetSrc;

          if (hasDeferredPending) {
            if (deferredImageObserver) {
              if (image.dataset.moriDeferredImageObserved !== "1") {
                image.dataset.moriDeferredImageObserved = "1";
                deferredImageObserver.observe(image);
              }
            } else {
              activateDeferredImageSource(image);
            }
          }
        }

        if (image.dataset.moriImageBlurhashBound !== "1") {
          image.dataset.moriImageBlurhashBound = "1";

          let cleaned = false;
          let revealStarted = false;
          let shouldSkipReveal = false;
          const shouldUseBackgroundPlaceholder = !image.getAttribute("data-origin-src")?.trim();
          const isWaitingForDeferredSource = () => {
            const currentSrc = image.getAttribute("src")?.trim() || "";
            const deferredSrc = image.getAttribute("data-origin-src")?.trim() || "";
            return deferredSrc.length > 0 && currentSrc !== deferredSrc;
          };
          const cleanupPlaceholder = () => {
            if (cleaned) {
              return;
            }
            cleaned = true;
            image.removeEventListener("load", handleImageLoad);
            image.removeEventListener("error", handleImageError);
            image.style.removeProperty("filter");
            image.style.removeProperty("will-change");
            image.style.removeProperty("background-image");
            image.style.removeProperty("background-color");
            image.style.removeProperty("background-size");
            image.style.removeProperty("background-position");
            image.style.removeProperty("background-repeat");
            image.style.removeProperty("opacity");
            image.style.removeProperty("transition");
          };

          const prepareRevealStyles = () => {
            image.style.willChange = "opacity, filter";
            image.style.filter = `blur(${IMAGE_REVEAL_BLUR_PX}px)`;
          };

          const applyPlaceholder = (dataUrl: string) => {
            prepareRevealStyles();
            if (!shouldUseBackgroundPlaceholder) {
              image.style.opacity = BLURHASH_PLACEHOLDER_OPACITY;
              return;
            }
            image.style.removeProperty("background-color");
            if (dataUrl) {
              image.style.backgroundImage = `url("${dataUrl}")`;
              image.style.backgroundSize = "contain";
              image.style.backgroundPosition = "center";
              image.style.backgroundRepeat = "no-repeat";
            } else {
              image.style.removeProperty("background-image");
              image.style.removeProperty("background-size");
              image.style.removeProperty("background-position");
              image.style.removeProperty("background-repeat");
            }
            image.style.opacity = BLURHASH_PLACEHOLDER_OPACITY;
          };

          const runRevealAnimation = (instant: boolean) => {
            if (revealStarted) {
              return;
            }
            revealStarted = true;

            if (instant) {
              image.style.opacity = "1";
              image.style.filter = "blur(0px)";
              cleanupPlaceholder();
              return;
            }

            const currentOpacity = Number.parseFloat(image.style.opacity || "");
            const startOpacity = Number.isFinite(currentOpacity) ? currentOpacity : IMAGE_REVEAL_START_OPACITY;

            const revealAnimation = animateElement(
              image,
              {
                opacity: [startOpacity, 1],
                filter: [`blur(${IMAGE_REVEAL_BLUR_PX}px)`, "blur(0px)"],
              },
              {
                duration: IMAGE_REVEAL_DURATION_MS / 1000,
                easing: IMAGE_REVEAL_EASING,
              },
            );

            void revealAnimation.finished.then(() => {
              cleanupPlaceholder();
            }).catch(() => {
              cleanupPlaceholder();
            });
          };

          const handleImageLoad = () => {
            if (isWaitingForDeferredSource()) {
              return;
            }
            window.requestAnimationFrame(() => {
              runRevealAnimation(shouldSkipReveal);
            });
          };

          const handleImageError = () => {
            const hasFallback = Boolean(image.getAttribute("data-origin-src")?.trim());
            if (hasFallback) {
              prepareRevealStyles();
              image.style.opacity = BLURHASH_PLACEHOLDER_OPACITY;
              return;
            }

            image.style.opacity = "1";
            cleanupPlaceholder();
          };

          image.addEventListener("load", handleImageLoad);
          image.addEventListener("error", handleImageError);

          if (image.complete && image.naturalWidth > 0) {
            shouldSkipReveal = true;
          }

          if (shouldUseBackgroundPlaceholder && (isWaitingForDeferredSource() || !image.complete || image.naturalWidth === 0)) {
            const source =
              image.getAttribute("data-origin-src") ||
              image.currentSrc ||
              image.getAttribute("src") ||
              "";
            const cachedDataUrl = getCachedImagePlaceholderDataUrl(source);
            if (cachedDataUrl) {
              applyPlaceholder(cachedDataUrl);
            } else {
              applyPlaceholder(fallbackBlurhashDataUrl);
              void resolvePerImagePlaceholderDataUrl(source).then((dataUrl) => {
                if (cleaned || !dataUrl) {
                  return;
                }
                applyPlaceholder(dataUrl);
              });
            }
          }

          if (!isWaitingForDeferredSource() && image.complete && image.naturalWidth > 0) {
            handleImageLoad();
          } else if (!isWaitingForDeferredSource() && image.complete && image.naturalWidth === 0) {
            handleImageError();
          }
        }

        if (image.dataset.moriImageFallbackBound === "1") {
          return;
        }

        const fallbackSrc = image.getAttribute("data-origin-src")?.trim();
        const fallbackSrcSet = image.getAttribute("data-origin-srcset")?.trim();
        const fallbackSizes = image.getAttribute("data-origin-sizes")?.trim();
        if (!fallbackSrc) {
          return;
        }

        image.dataset.moriImageFallbackBound = "1";

        const applyFallback = () => {
          const currentSrc = image.getAttribute("src")?.trim();
          if (!currentSrc || currentSrc === fallbackSrc) {
            image.removeAttribute("data-origin-src");
            image.removeAttribute("data-origin-srcset");
            image.removeAttribute("data-origin-sizes");
            return false;
          }

          const shouldUseFallbackBackgroundPlaceholder = !image.getAttribute("data-origin-src")?.trim();
          image.setAttribute("src", fallbackSrc);
          if (image.dataset.moriImageBlurhashBound === "1" && shouldUseFallbackBackgroundPlaceholder) {
            image.style.removeProperty("background-color");
            image.style.willChange = "opacity, filter";
            image.style.filter = `blur(${IMAGE_REVEAL_BLUR_PX}px)`;
            image.style.opacity = BLURHASH_PLACEHOLDER_OPACITY;
            void resolvePerImagePlaceholderDataUrl(fallbackSrc).then((dataUrl) => {
              if (!dataUrl) {
                return;
              }
              image.style.backgroundImage = `url("${dataUrl}")`;
              image.style.backgroundSize = "contain";
              image.style.backgroundPosition = "center";
              image.style.backgroundRepeat = "no-repeat";
            });
          }

          if (fallbackSrcSet) {
            image.setAttribute("srcset", fallbackSrcSet);
          } else {
            image.removeAttribute("srcset");
          }
          if (fallbackSizes) {
            image.setAttribute("sizes", fallbackSizes);
          } else {
            image.removeAttribute("sizes");
          }
          image.removeAttribute("data-origin-src");
          image.removeAttribute("data-origin-srcset");
          image.removeAttribute("data-origin-sizes");
          return true;
        };

        const handleImageError = () => {
          const switched = applyFallback();
          if (!switched) {
            image.removeEventListener("error", handleImageError);
          }
        };

        image.addEventListener("error", handleImageError);

        if (image.complete && image.naturalWidth === 0) {
          handleImageError();
        }
      });

      refreshImageZoomTargets();
    };

    const scheduleRootUnmount = (root: Root) => {
      if (pendingRootUnmounts.has(root)) {
        return;
      }

      pendingRootUnmounts.add(root);
      window.setTimeout(() => {
        pendingRootUnmounts.delete(root);
        root.unmount();
      }, 0);
    };

    const mountExcalidrawNode = async (node: HTMLElement) => {
      if (disposed || excalidrawRoots.has(node)) {
        return;
      }

      const source = String(node.dataset.source || "").trim();
      if (!source) {
        return;
      }

      const Excalidraw = await loadExcalidrawComponent();
      if (disposed || excalidrawRoots.has(node)) {
        return;
      }

      await waitForRenderableSize(node);
      if (disposed || excalidrawRoots.has(node)) {
        return;
      }

      const theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
      const appContainer = document.createElement("div");
      appContainer.className = "mori-excalidraw-app";
      node.replaceChildren(appContainer);

      const root = createRoot(appContainer);
      excalidrawRoots.set(node, root);
      root.render(
        <Excalidraw
          detectScroll={true}
          initialData={() => resolveExcalidrawInitialData(source)}
          theme={theme}
          viewModeEnabled
          zenModeEnabled
          excalidrawAPI={(api) => {
            window.setTimeout(() => {
              api?.scrollToContent?.(undefined, { fitToContent: true });
            }, 300);
          }}
        />,
      );

      if (!excalidrawHostCleanups.has(node)) {
        const activate = () => {
          excalidrawActiveHost = node;
          assignExcalidrawPortals(node);
        };
        node.addEventListener("pointerdown", activate, { capture: true });
        node.addEventListener("focusin", activate);
        excalidrawHostCleanups.set(node, () => {
          node.removeEventListener("pointerdown", activate, { capture: true });
          node.removeEventListener("focusin", activate);
          if (excalidrawActiveHost === node) {
            excalidrawActiveHost = null;
          }
        });
      }

      // Excalidraw determines mobile UI from container size; trigger re-measure after mount.
      window.setTimeout(() => window.dispatchEvent(new Event("resize")), 16);
      window.setTimeout(() => window.dispatchEvent(new Event("resize")), 280);
    };

    const mountAllExcalidraw = () => {
      if (disposed) {
        return;
      }

      const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-mori-excalidraw="1"]'));
      nodes.forEach((node) => {
        void mountExcalidrawNode(node);
      });
    };

    const cleanupRemovedExcalidraw = () => {
      excalidrawRoots.forEach((root, node) => {
        if (!document.contains(node)) {
          scheduleRootUnmount(root);
          excalidrawRoots.delete(node);
          excalidrawHostCleanups.get(node)?.();
          excalidrawHostCleanups.delete(node);
        }
      });
    };

    const shuffleFriendLinks = () => {
      if (disposed) {
        return;
      }

      const containers = Array.from(document.querySelectorAll<HTMLElement>('.mori-friend-links:not([data-shuffled="true"])'));
      containers.forEach((container) => {
        container.setAttribute("data-shuffled", "true");
        const cards = Array.from(container.children);
        if (cards.length <= 1) {
          return;
        }

        for (let i = cards.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const temp = cards[i];
          cards[i] = cards[j] as Element;
          cards[j] = temp as Element;
        }

        cards.forEach((card) => container.appendChild(card));
      });
    };

    const observer = new MutationObserver(() => {
      cleanupRemovedExcalidraw();
      mountAllExcalidraw();
      shuffleFriendLinks();
      enhanceImages();
      refreshImageZoomTargets();
    });

    const startRuntime = () => {
      if (disposed || runtimeStarted) {
        return;
      }
      runtimeStarted = true;
      mountAllExcalidraw();
      shuffleFriendLinks();
      setupImageZoom();
      enhanceImages();
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    };

    const scheduleRuntimeStart = () => {
      startupTimer = window.setTimeout(() => {
        startRuntime();
      }, 0);
    };

    if (document.readyState === "complete") {
      scheduleRuntimeStart();
    } else {
      const onLoad = () => {
        pendingLoadListener = null;
        scheduleRuntimeStart();
      };
      pendingLoadListener = onLoad;
      window.addEventListener("load", onLoad, { once: true });
    }

    if (!excalidrawPortalObserver) {
      excalidrawPortalObserver = new MutationObserver(() => {
        if (excalidrawActiveHost) {
          assignExcalidrawPortals(excalidrawActiveHost);
        }
        updateExcalidrawPortals();
      });
      excalidrawPortalObserver.observe(document.body, { childList: true, subtree: true });
      window.addEventListener("resize", updateExcalidrawPortals);
      window.addEventListener("scroll", updateExcalidrawPortals, true);
    }

    const clickHandler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      const copyButton = target.closest<HTMLButtonElement>(".mori-code-copy");
      if (copyButton) {
        const code = decodeBase64Utf8(copyButton.dataset.codeB64 || "");
        void copyText(code).then((ok) => {
          copyButton.dataset.copyState = ok ? "copied" : "failed";
          copyButton.textContent = ok ? "已复制" : "复制失败";

          window.setTimeout(() => {
            copyButton.dataset.copyState = "";
            copyButton.textContent = "复制";
          }, 1200);
        });
        return;
      }

      const tabTrigger = target.closest<HTMLButtonElement>(".mori-tab-trigger");
      if (!tabTrigger) {
        return;
      }

      const root = tabTrigger.closest<HTMLElement>(".mori-tabs-root");
      if (!root) {
        return;
      }

      const index = tabTrigger.dataset.tabIndex || "0";
      activateTab(root, index);
    };

    const keydownHandler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      const tabTrigger = target.closest<HTMLButtonElement>(".mori-tab-trigger");
      if (!tabTrigger) {
        return;
      }

      const root = tabTrigger.closest<HTMLElement>(".mori-tabs-root");
      if (!root) {
        return;
      }

      const triggers = Array.from(root.querySelectorAll<HTMLButtonElement>(".mori-tab-trigger"));
      if (triggers.length === 0) {
        return;
      }

      const currentIndex = Math.max(
        0,
        triggers.findIndex((button) => button === tabTrigger),
      );

      if (event.key === "ArrowRight") {
        event.preventDefault();
        const next = triggers[(currentIndex + 1) % triggers.length];
        if (!next) {
          return;
        }
        activateTab(root, next.dataset.tabIndex || "0");
        next.focus();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        const next = triggers[(currentIndex - 1 + triggers.length) % triggers.length];
        if (!next) {
          return;
        }
        activateTab(root, next.dataset.tabIndex || "0");
        next.focus();
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        const next = triggers[0];
        if (!next) {
          return;
        }
        activateTab(root, next.dataset.tabIndex || "0");
        next.focus();
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        const next = triggers[triggers.length - 1];
        if (!next) {
          return;
        }
        activateTab(root, next.dataset.tabIndex || "0");
        next.focus();
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activateTab(root, tabTrigger.dataset.tabIndex || "0");
      }
    };

    document.addEventListener("click", clickHandler);
    document.addEventListener("keydown", keydownHandler);

    // Footnote hover tooltip
    let footnoteTooltip: HTMLElement | null = null;
    let activeFootnoteRef: HTMLElement | null = null;
    let hideTimer = 0;

    const removeTooltip = () => {
      if (hideTimer) {
        window.clearTimeout(hideTimer);
        hideTimer = 0;
      }
      if (footnoteTooltip) {
        footnoteTooltip.remove();
        footnoteTooltip = null;
      }
      activeFootnoteRef = null;
    };

    const showFootnoteTooltip = (ref: HTMLElement) => {
      if (activeFootnoteRef === ref && footnoteTooltip) {
        if (hideTimer) {
          window.clearTimeout(hideTimer);
          hideTimer = 0;
        }
        return;
      }
      removeTooltip();

      const link = ref.querySelector<HTMLAnchorElement>(".mori-footnote-link");
      if (!link) {
        return;
      }

      const targetId = link.getAttribute("href")?.replace(/^#/, "");
      if (!targetId) {
        return;
      }

      const footnoteItem = document.getElementById(targetId);
      if (!footnoteItem) {
        return;
      }

      const body = footnoteItem.querySelector<HTMLElement>(".mori-footnote-body");
      if (!body) {
        return;
      }

      const text = body.textContent?.trim();
      if (!text) {
        return;
      }

      activeFootnoteRef = ref;
      footnoteTooltip = document.createElement("div");
      footnoteTooltip.className = "mori-footnote-tooltip";
      footnoteTooltip.textContent = text;
      document.body.appendChild(footnoteTooltip);

      const refRect = ref.getBoundingClientRect();
      const tipRect = footnoteTooltip.getBoundingClientRect();
      let left = refRect.left + refRect.width / 2 - tipRect.width / 2;
      const top = refRect.top - tipRect.height - 8;

      if (left < 8) {
        left = 8;
      }
      if (left + tipRect.width > window.innerWidth - 8) {
        left = window.innerWidth - 8 - tipRect.width;
      }

      footnoteTooltip.style.left = `${left}px`;
      footnoteTooltip.style.top = `${top < 8 ? refRect.bottom + 8 : top}px`;
      footnoteTooltip.style.opacity = "1";
    };

    const footnoteMouseOver = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }
      const ref = target.closest<HTMLElement>(".mori-footnote-ref");
      if (ref) {
        showFootnoteTooltip(ref);
      }
    };

    const footnoteMouseOut = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }
      const ref = target.closest<HTMLElement>(".mori-footnote-ref");
      if (ref && activeFootnoteRef === ref) {
        if (hideTimer) {
          window.clearTimeout(hideTimer);
        }
        hideTimer = window.setTimeout(removeTooltip, 200);
      }
    };

    document.addEventListener("mouseover", footnoteMouseOver);
    document.addEventListener("mouseout", footnoteMouseOut);

    return () => {
      disposed = true;
      window.clearTimeout(startupTimer);
      if (pendingLoadListener) {
        window.removeEventListener("load", pendingLoadListener);
        pendingLoadListener = null;
      }
      deferredImageObserver?.disconnect();
      if (imageZoom) {
        imageZoom.off("open", handleImageZoomOpen);
        void imageZoom.close();
        imageZoom.detach();
        imageZoom = null;
      }
      observer.disconnect();
      excalidrawRoots.forEach((root) => {
        scheduleRootUnmount(root);
      });
      excalidrawHostCleanups.forEach((cleanup) => cleanup());
      excalidrawHostCleanups.clear();
      excalidrawRoots.clear();
      document.removeEventListener("click", clickHandler);
      document.removeEventListener("keydown", keydownHandler);
      document.removeEventListener("mouseover", footnoteMouseOver);
      document.removeEventListener("mouseout", footnoteMouseOut);
      removeTooltip();
    };
  }, []);

  return null;
}
