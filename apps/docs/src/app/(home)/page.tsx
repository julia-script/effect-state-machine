import Link from "next/link"
import { appName } from "@/lib/shared"

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col justify-center text-center">
      <h1 className="mb-4 font-bold text-2xl">{appName}</h1>
      <p className="text-fd-muted-foreground">
        Head to{" "}
        <Link href="/docs" className="font-medium text-fd-foreground underline">
          /docs
        </Link>{" "}
        to read the documentation.
      </p>
    </div>
  )
}
