"use client";

import dynamic from "next/dynamic";

const MarkdownRuntime = dynamic(
  () => import("@/components/markdown-runtime").then((module) => module.MarkdownRuntime),
  { ssr: false },
);

export function MarkdownRuntimeLazy() {
  return <MarkdownRuntime />;
}
