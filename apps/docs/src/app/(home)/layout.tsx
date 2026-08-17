import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google"
import { LandingNav } from "@/components/landing/landing-nav"
import "./landing.css"

const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-landing-display",
  weight: ["400", "500", "600", "700"],
})

const body = Inter({
  subsets: ["latin"],
  variable: "--font-landing-body",
})

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-landing-mono",
  weight: ["400", "500", "600", "700"],
})

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <div className={`${display.variable} ${body.variable} ${mono.variable} landing`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <LandingNav />
      {children}
    </div>
  )
}
