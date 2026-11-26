import L from "leaflet";
import { antPath } from "leaflet-ant-path";
import { useEffect } from "react";
import { useMap } from "react-leaflet";
import { useTokenValue } from "../lib/theme";
import type { LatLng } from "./mapIcons";

/**
 * An animated "marching ants" line between points: the maps draw it from the carrier's last scan
 * to the courier's live position. No trail of past courier positions is ever drawn.
 */
export function AnimatedRoute(props: {
  readonly positions: readonly LatLng[];
  /** The design token of its colour (`map-route` unless given). */
  readonly token?: string;
  readonly dashArray?: string;
  /** 1 for the way travelled; lower for the way still ahead. */
  readonly opacity?: number;
}): null {
  const map = useMap();
  const color = useTokenValue(props.token ?? "map-route");
  const dashArray = props.dashArray ?? "10, 20";
  const opacity = props.opacity ?? 1;

  useEffect(() => {
    if (props.positions.length === 0) {
      return undefined;
    }
    const dashes = dashArray.split(",").map(Number);
    const solid = dashes.length >= 2 && dashes[0] === 0 && dashes[1] === 0;
    const path = antPath([...props.positions], {
      use: L.polyline,
      delay: 600,
      dashArray: dashes,
      weight: 4,
      opacity,
      color: solid ? color : "transparent",
      pulseColor: color,
      paused: solid,
      reverse: false,
      hardwareAccelerated: true,
    });
    path.addTo(map);
    return () => {
      map.removeLayer(path);
    };
  }, [props.positions, color, dashArray, opacity, map]);

  return null;
}
