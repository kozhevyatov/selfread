import type { ReactNode, SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number };

/** Фабрика иконок в стиле Lucide: 24×24, обводка currentColor. */
export function icon(name: string, children: ReactNode) {
  function Icon({ size, strokeWidth = 2, className, ...rest }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={size ?? 24}
        height={size ?? 24}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={className ?? "size-5"}
        {...rest}
      >
        {children}
      </svg>
    );
  }
  Icon.displayName = `Icon(${name})`;
  return Icon;
}

/** Заливные иконки транспорта — в плеере они читаются лучше контурных. */
export function PlayFill(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={props.className ?? "size-5"} fill="currentColor">
      <path d="M7 4.9v14.2c0 .8.9 1.3 1.6.9l11.3-7.1c.6-.4.6-1.3 0-1.7L8.6 4C7.9 3.6 7 4.1 7 4.9Z" />
    </svg>
  );
}

export function PauseFill(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={props.className ?? "size-5"} fill="currentColor">
      <rect x="5.5" y="4" width="4.5" height="16" rx="1.4" />
      <rect x="14" y="4" width="4.5" height="16" rx="1.4" />
    </svg>
  );
}

export function PrevFill(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={props.className ?? "size-5"} fill="currentColor">
      <path d="M19 5.6v12.8c0 .8-.9 1.3-1.6.8L8.6 13c-.6-.4-.6-1.3 0-1.7l8.8-6.3c.7-.5 1.6 0 1.6.6Z" />
      <rect x="5" y="5" width="2.6" height="14" rx="1.2" />
    </svg>
  );
}

export function NextFill(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={props.className ?? "size-5"} fill="currentColor">
      <path d="M5 5.6v12.8c0 .8.9 1.3 1.6.8l8.8-6.2c.6-.4.6-1.3 0-1.7L6.6 5C5.9 4.5 5 5 5 5.6Z" />
      <rect x="16.4" y="5" width="2.6" height="14" rx="1.2" />
    </svg>
  );
}

export function HeartFill(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={props.className ?? "size-5"} fill="currentColor">
      <path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" />
    </svg>
  );
}
