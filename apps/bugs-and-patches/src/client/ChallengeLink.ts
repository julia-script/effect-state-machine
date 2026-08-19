export interface ClipboardLike {
  readonly writeText: (value: string) => Promise<void>
}

export const copy = async (clipboard: ClipboardLike, url: string): Promise<"Copied" | "Failed"> => {
  try {
    await clipboard.writeText(url)
    return "Copied"
  } catch {
    return "Failed"
  }
}
