import { RootProvider } from "fumadocs-ui/provider/next"
import type { Metadata } from "next"
import { appName } from "@/lib/shared"
import "./global.css"

export const metadata: Metadata = {
  title: {
    default: appName,
    template: `%s | ${appName}`,
  },
}

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  )
}
