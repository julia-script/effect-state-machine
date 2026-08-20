import { createMDX } from "fumadocs-mdx/next"

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  agentRules: false,
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: "/docs/reference/machine-definition",
        destination: "/docs/reference/api/Machine",
        permanent: true,
      },
      {
        source: "/docs/reference/machine-runtime",
        destination: "/docs/reference/api/Machine",
        permanent: true,
      },
      {
        source: "/docs/reference/devtools",
        destination: "/docs/reference/api/Graph",
        permanent: true,
      },
    ]
  },
  turbopack: {
    resolveAlias: {
      "@effect-state-machine/studio-client": "../../packages/studio-client/dist/index.js",
      "@effect-state-machine/studio-react": "../../packages/studio-react/dist/index.js",
      "effect-state-machine": "../../packages/core/dist/index.js",
      "effect-state-machine/Machine": "../../packages/core/dist/Machine.js",
      "effect-state-machine/MachineEngine": "../../packages/core/dist/MachineEngine.js",
      "effect-state-machine/MachineStore": "../../packages/core/dist/MachineStore.js",
      "effect-state-machine/LocalStorageMachineStore":
        "../../packages/core/dist/LocalStorageMachineStore.js",
      "effect-state-machine/MachineWorkflow": "../../packages/core/dist/MachineWorkflow.js",
      "effect-state-machine/SourceLocation": "../../packages/core/dist/SourceLocation.js",
      "effect-state-machine/devtools": "../../packages/core/dist/devtools.js",
    },
  },
}

export default withMDX(config)
