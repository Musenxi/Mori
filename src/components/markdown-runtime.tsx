"use client";

import { decode as decodeBlurhash } from "blurhash";
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

function decodeHashToDataUrl(hash: string) {
  try {
    const width = 32;
    const height = 32;
    const pixels = decodeBlurhash(hash, width, height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      return "";
    }

    const imageData = context.createImageData(width, height);
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

function normalizeImageSource(input: string) {
  const source = input.trim();
  if (!source || source.startsWith("data:") || source.startsWith("blob:") || source.startsWith("javascript:")) {
    return "";
  }

  try {
    const resolved = new URL(source, window.location.origin);
    if (resolved.pathname === "/_next/image") {
      const original = resolved.searchParams.get("url")?.trim() || "";
      if (original) {
        return new URL(original, window.location.origin).toString();
      }
    }

    return resolved.toString();
  } catch {
    return "";
  }
}

function parseBlurhashPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const parsed = payload as { ok?: unknown; hash?: unknown };
  if (!parsed.ok || typeof parsed.hash !== "string") {
    return "";
  }

  return parsed.hash.trim();
}

async function resolvePerImagePlaceholderDataUrl(inputSource: string) {
  const source = normalizeImageSource(inputSource);
  if (!source) {
    return "";
  }

  if (imagePlaceholderDataUrlBySource.has(source)) {
    return imagePlaceholderDataUrlBySource.get(source) || "";
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
      const hash = parseBlurhashPayload(payload);
      if (!hash) {
        return "";
      }

      const cachedDataUrl = blurhashDataUrlByHash.get(hash);
      if (cachedDataUrl) {
        return cachedDataUrl;
      }

      const dataUrl = decodeHashToDataUrl(hash);
      if (!dataUrl) {
        return "";
      }

      blurhashDataUrlByHash.set(hash, dataUrl);
      return dataUrl;
    } catch {
      return "";
    }
  })()
    .then((dataUrl) => {
      imagePlaceholderDataUrlBySource.set(source, dataUrl);
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
    let disposed = false;

    const enhanceImages = () => {
      if (disposed) {
        return;
      }

      const fallbackBlurhashDataUrl = getDefaultBlurhashDataUrl();
      const images = Array.from(document.querySelectorAll<HTMLImageElement>("img"));
      images.forEach((image) => {
        if (!image.getAttribute("loading")) {
          image.setAttribute("loading", "lazy");
        }
        if (!image.getAttribute("decoding")) {
          image.setAttribute("decoding", "async");
        }

        if (image.dataset.moriImageBlurhashBound !== "1") {
          image.dataset.moriImageBlurhashBound = "1";

          let cleaned = false;
          const cleanupPlaceholder = () => {
            if (cleaned) {
              return;
            }
            cleaned = true;
            image.removeEventListener("load", handleImageLoad);
            image.removeEventListener("error", handleImageError);
            image.style.removeProperty("background-image");
            image.style.removeProperty("background-color");
            image.style.removeProperty("background-size");
            image.style.removeProperty("background-position");
            image.style.removeProperty("background-repeat");
            image.style.removeProperty("opacity");
            image.style.removeProperty("transition");
          };

          const applyPlaceholder = (dataUrl: string) => {
            image.style.backgroundColor = "var(--card, #e5e7eb)";
            if (dataUrl) {
              image.style.backgroundImage = `url("${dataUrl}")`;
              image.style.backgroundSize = "cover";
              image.style.backgroundPosition = "center";
              image.style.backgroundRepeat = "no-repeat";
            } else {
              image.style.removeProperty("background-image");
              image.style.removeProperty("background-size");
              image.style.removeProperty("background-position");
              image.style.removeProperty("background-repeat");
            }
            image.style.opacity = "0";
            image.style.transition = "opacity 320ms ease";
          };

          const handleImageLoad = () => {
            window.requestAnimationFrame(() => {
              image.style.opacity = "1";
              window.setTimeout(() => {
                cleanupPlaceholder();
              }, 240);
            });
          };

          const handleImageError = () => {
            const hasFallback = Boolean(image.getAttribute("data-origin-src")?.trim());
            if (hasFallback) {
              image.style.opacity = "0";
              return;
            }

            image.style.opacity = "1";
            cleanupPlaceholder();
          };

          image.addEventListener("load", handleImageLoad);
          image.addEventListener("error", handleImageError);

          if (!image.complete || image.naturalWidth === 0) {
            applyPlaceholder(fallbackBlurhashDataUrl);

            const source =
              image.getAttribute("data-origin-src") ||
              image.currentSrc ||
              image.getAttribute("src") ||
              "";
            void resolvePerImagePlaceholderDataUrl(source).then((dataUrl) => {
              if (cleaned || !dataUrl) {
                return;
              }
              applyPlaceholder(dataUrl);
            });
          }

          if (image.complete && image.naturalWidth > 0) {
            handleImageLoad();
          } else if (image.complete && image.naturalWidth === 0) {
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

          image.setAttribute("src", fallbackSrc);
          if (image.dataset.moriImageBlurhashBound === "1") {
            image.style.backgroundColor = "var(--card, #e5e7eb)";
            image.style.opacity = "0";
            image.style.transition = "opacity 320ms ease";
            void resolvePerImagePlaceholderDataUrl(fallbackSrc).then((dataUrl) => {
              if (!dataUrl) {
                return;
              }
              image.style.backgroundImage = `url("${dataUrl}")`;
              image.style.backgroundSize = "cover";
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
    });

    mountAllExcalidraw();
    shuffleFriendLinks();
    enhanceImages();
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

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
