import { createMDX } from "fumadocs-mdx/next"

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  agentRules: false,
  reactStrictMode: true,
  turbopack: {
    resolveAlias: {
      "@effect-state-machine/studio-client": "../../packages/studio-client/dist/index.js",
      "@effect-state-machine/studio-react": "../../packages/studio-react/dist/index.js",
      "effect-state-machine": "../../packages/core/dist/index.js",
      "effect-state-machine/Machine": "../../packages/core/dist/Machine.js",
      "effect-state-machine/devtools": "../../packages/core/dist/devtools.js",
    },
  },
}

export default withMDX(config)
