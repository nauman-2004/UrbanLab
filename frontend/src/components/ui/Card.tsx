import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-panel2 to-panel ${className}`}
    >
      {children}
    </section>
  );
}

export function CardHeader({ icon, title, aside }: { icon?: IconName; title: ReactNode; aside?: ReactNode }) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-3.5 py-2.5">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold">
        {icon && <Icon name={icon} className="size-[15px] text-accent2" />}
        {title}
      </h2>
      {aside && <div className="truncate text-[11px] font-medium text-dim">{aside}</div>}
    </header>
  );
}

export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mb-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-dim ${className}`}>{children}</div>;
}

export function Button({
  children,
  onClick,
  variant = "primary",
  className = "",
  disabled,
  title,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "outline" | "danger";
  className?: string;
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
}) {
  const styles = {
    primary: "bg-gradient-to-br from-accent to-violet-600 text-white shadow-[0_6px_18px_#7c3aed44] hover:brightness-110",
    ghost: "text-muted hover:bg-white/5 hover:text-ink",
    outline: "border border-line2 text-muted hover:border-accent2/60 hover:text-ink",
    danger: "bg-red-500 text-white hover:bg-red-400",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 py-1.5 text-[12.5px] font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent2 disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}
