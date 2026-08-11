import defaultMdxComponents from "fumadocs-ui/mdx"
import type { MDXComponents } from "mdx/types"
import { EmbeddedStudioDemo } from "./embedded-studio-demo"

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    EmbeddedStudioDemo,
    ...components,
  } satisfies MDXComponents
}

export const useMDXComponents = getMDXComponents

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>
}
