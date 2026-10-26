import { icons, type IconName } from "./icons";

/** Renders a trusted, static icon from the icon set. `label` makes it accessible; otherwise it is decorative. */
export function Icon({ name, className, label }: { name: IconName; className?: string; label?: string }) {
  return (
    <span
      className={`icon inline-flex size-[1.1em] shrink-0 [&>svg]:size-full ${className ?? ""}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: icons[name] }}
    />
  );
}
