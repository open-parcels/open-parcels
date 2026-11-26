/**
 * A carrier's tile: the provider's bundled logo when it has one (the carrier list gives its URL),
 * otherwise a monogram in the carrier's brand colour or a stable colour from its id.
 */
import type { CSSProperties, ReactNode } from "react";
import { apiUrl } from "../api/fetcher";
import { useCarriers } from "../api/queries";

/**
 * Brand colours for monograms of carriers without a bundled logo: the carrier's own identity, so
 * they stay the same in every theme. Other monograms take a colour from the id and the theme's
 * `--monogram-text`.
 */
const BRAND: Readonly<Record<string, readonly [string, string]>> = {
  gls: ["#061ab1", "#ffd100"],
  amazon: ["#232f3e", "#ff9900"],
  postnl: ["#ff6200", "#ffffff"],
};

function colours(id: string): readonly [string, string] {
  const known = BRAND[id.toLowerCase()];
  if (known !== undefined) {
    return known;
  }
  let hash = 0;
  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }
  return [`hsl(${hash} 55% 42%)`, "var(--monogram-text)"];
}

function initials(name: string): string {
  const words = name.split(/[\s_-]+/).filter((word) => word !== "");
  const text = words.length > 1 ? words.map((word) => word.charAt(0)).join("") : name;
  return text.slice(0, 3);
}

/** The carrier's display name from the provider list, or its id. */
export function useCarrierName(id: string): string {
  const carriers = useCarriers();
  return carriers.data?.find((carrier) => carrier.id === id)?.name ?? id;
}

/** A carrier's tile from what the carrier list says: its logo, or else a monogram. */
export function LogoTile(props: {
  readonly carrier: string;
  readonly name: string;
  readonly logo: string | null;
  readonly size?: number;
}): ReactNode {
  const size = props.size ?? 40;
  if (props.logo !== null) {
    // Decoration: the carrier name is always written out next to it.
    return (
      <img
        className="carrier-logo carrier-logo-image"
        src={apiUrl(props.logo)}
        alt=""
        width={size}
        height={size}
        loading="lazy"
      />
    );
  }
  const [background, color] = colours(props.carrier);
  const style: CSSProperties = {
    width: size,
    height: size,
    background,
    color,
    fontSize: Math.round(size * 0.3),
  };
  return (
    // The initials come from CSS (`attr(data-initials)`): the tile is decoration, and the carrier
    // name is always written out next to it.
    <span
      className="carrier-logo"
      style={style}
      aria-hidden="true"
      data-initials={initials(props.name)}
    />
  );
}

/** A carrier's tile by id: looks its logo up in the carrier list. */
export function CarrierLogo(props: {
  readonly carrier: string;
  readonly size?: number;
}): ReactNode {
  const carriers = useCarriers();
  const logo = carriers.data?.find((carrier) => carrier.id === props.carrier)?.logo ?? null;
  return (
    <LogoTile
      carrier={props.carrier}
      name={props.carrier}
      logo={logo}
      {...(props.size === undefined ? {} : { size: props.size })}
    />
  );
}
