import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react"

export const Page = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <main className={`page ${className}`.trim()}>{children}</main>
)

export const Panel = ({ children, className = "", ...props }: HTMLAttributes<HTMLElement>) => (
  <section className={`panel ${className}`.trim()} {...props}>
    {children}
  </section>
)

export const Button = ({
  children,
  tone = "pear",
  variant = "push",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly tone?: "pear" | "cyan" | "coral" | "ink"
  readonly variant?: "push" | "soft" | "outline"
}) => (
  <button
    className={`btn btn--${variant} btn--${tone} ${className}`.trim()}
    type="button"
    {...props}
  >
    {children}
  </button>
)

export const Badge = ({ children, tone = "ink" }: { children: ReactNode; tone?: string }) => (
  <span className={`badge badge--${tone}`}>{children}</span>
)

export const Avatar = ({
  name,
  src,
  size = "normal",
}: {
  readonly name: string
  readonly src?: string | null
  readonly size?: "small" | "normal" | "large"
}) =>
  src === undefined || src === null ? (
    <span className={`avatar avatar--${size} avatar--neutral`} aria-label={`${name}, anonymous`}>
      {name.trim().slice(0, 1).toUpperCase() || "?"}
    </span>
  ) : (
    <img className={`avatar avatar--${size}`} src={src} alt="" width="48" height="48" />
  )

export const Notice = ({
  children,
  tone = "info",
  onDismiss,
}: {
  readonly children: ReactNode
  readonly tone?: "info" | "error" | "success"
  readonly onDismiss?: () => void
}) => (
  <div className={`notice notice--${tone}`} role={tone === "error" ? "alert" : "status"}>
    <span>{children}</span>
    {onDismiss === undefined ? null : (
      <button type="button" className="notice__close" aria-label="Dismiss message" onClick={onDismiss}>
        ×
      </button>
    )}
  </div>
)

export const Field = ({
  label,
  helper,
  error,
  children,
}: {
  readonly label: string
  readonly helper?: string
  readonly error?: string | null
  readonly children: ReactNode
}) => (
  <label className="field">
    <span className="field__label">{label}</span>
    {children}
    <span className={`field__helper ${error === undefined || error === null ? "" : "field__helper--error"}`}>
      {error ?? helper ?? "\u00a0"}
    </span>
  </label>
)

export const EmptyState = ({
  title,
  children,
  action,
}: {
  readonly title: string
  readonly children: ReactNode
  readonly action?: ReactNode
}) => (
  <div className="empty-state">
    <span className="empty-state__mark" aria-hidden="true">?</span>
    <div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
    {action}
  </div>
)
