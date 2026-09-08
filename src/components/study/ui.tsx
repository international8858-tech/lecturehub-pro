import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from "react";
import { X } from "lucide-react";
import type { FolderColor, Difficulty } from "@/lib/db";

export const tint: Record<FolderColor, { bg: string; fg: string; solid: string }> = {
  blue: { bg: "bg-tint-blue/12", fg: "text-tint-blue", solid: "bg-tint-blue" },
  orange: { bg: "bg-tint-orange/14", fg: "text-tint-orange", solid: "bg-tint-orange" },
  green: { bg: "bg-tint-green/14", fg: "text-tint-green", solid: "bg-tint-green" },
  purple: { bg: "bg-tint-purple/12", fg: "text-tint-purple", solid: "bg-tint-purple" },
  pink: { bg: "bg-tint-pink/14", fg: "text-tint-pink", solid: "bg-tint-pink" },
};
export const colors: FolderColor[] = ["blue", "orange", "green", "purple", "pink"];

export const difficulties: { key: Difficulty; label: string; cls: string }[] = [
  { key: "L1", label: "Level 1", cls: "bg-tint-green/15 text-tint-green" },
  { key: "L2", label: "Level 2", cls: "bg-tint-blue/15 text-tint-blue" },
  { key: "Hard", label: "Hard", cls: "bg-destructive/12 text-destructive" },
  { key: "Exam", label: "Exam Special", cls: "bg-tint-purple/15 text-tint-purple" },
];

export function useObjectUrl(blob: Blob | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return setUrl(null);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export function BlobImage({ blob, className, alt = "" }: { blob: Blob | null | undefined; className?: string; alt?: string }) {
  const url = useObjectUrl(blob);
  if (!url) return <div className={`bg-muted ${className ?? ""}`} />;
  return <img src={url} alt={alt} className={className} loading="lazy" />;
}

/** Wraps children; fires onLongPress after 480ms hold, onTap on quick release. */
export function LongPressable({
  onLongPress,
  onTap,
  className,
  children,
}: {
  onLongPress: () => void;
  onTap?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const down = (e: PointerEvent) => {
    fired.current = false;
    start.current = { x: e.clientX, y: e.clientY };
    clear();
    timer.current = window.setTimeout(() => {
      fired.current = true;
      if (navigator.vibrate) navigator.vibrate(15);
      onLongPress();
    }, 480);
  };
  const move = (e: PointerEvent) => {
    if (Math.abs(e.clientX - start.current.x) > 8 || Math.abs(e.clientY - start.current.y) > 8) clear();
  };
  const up = () => {
    const wasPending = !!timer.current;
    clear();
    if (wasPending && !fired.current) onTap?.();
  };
  return (
    <div
      className={`select-none touch-manipulation ${className ?? ""}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={clear}
      onPointerLeave={clear}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay animate-in fade-in" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl bg-card p-5 safe-bottom shadow-card animate-in slide-in-from-bottom-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-border" />
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-bold">{title}</h3>
            <button onClick={onClose} className="rounded-full bg-secondary p-1.5" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function SheetItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`press flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-semibold hover:bg-secondary ${
        danger ? "text-destructive" : ""
      }`}
    >
      <span className={`rounded-xl p-2 ${danger ? "bg-destructive/10" : "bg-secondary"}`}>{icon}</span>
      {label}
    </button>
  );
}

export function Btn({
  children,
  onClick,
  variant = "primary",
  className = "",
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const v = {
    primary: "bg-primary text-primary-foreground",
    secondary: "bg-secondary text-secondary-foreground",
    ghost: "bg-transparent text-foreground",
    danger: "bg-destructive text-destructive-foreground",
    success: "bg-success text-success-foreground",
  }[variant];
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`press inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold disabled:opacity-50 ${v} ${className}`}
    >
      {children}
    </button>
  );
}

export function Ring({ pct, size = 64, stroke = 7, color = "text-primary" }: { pct: number; size?: number; stroke?: number; color?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="fill-none stroke-secondary" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct / 100)}
        className={`fill-none stroke-current transition-all duration-500 ${color}`}
      />
    </svg>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-6 animate-in fade-in" onClick={onClose}>
      <div className="w-full max-w-sm rounded-3xl bg-card p-5 shadow-card animate-in zoom-in-95" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-base font-bold">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export const inputCls =
  "w-full rounded-2xl border border-input bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring";

export function fmt(s: number) {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
