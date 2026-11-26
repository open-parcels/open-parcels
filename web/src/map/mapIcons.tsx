import L from "leaflet";
import {
  Bike,
  Helicopter,
  Home,
  MapPin,
  Package,
  Plane,
  Ship,
  Train,
  Truck,
  Van,
} from "lucide-react";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

export type LatLng = [number, number];

/** `token` names a design token (`--map-…`), so markers follow the theme and the mode. */
function createDivIcon(iconNode: ReactNode, token: string, containerSize = 32): L.DivIcon {
  // Rendered once into a detached element: react-dom/server would add React's server renderer to
  // the bundle just for these icons.
  const container = document.createElement("div");
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      <div
        style={{
          color: `var(--${token})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: `${containerSize}px`,
          height: `${containerSize}px`,
          boxSizing: "border-box",
          filter: "drop-shadow(0px 2px 4px var(--map-marker-shadow))",
        }}
      >
        {iconNode}
      </div>,
    );
  });
  const html = container.innerHTML;
  root.unmount();
  return L.divIcon({
    html,
    className: "custom-leaflet-icon",
    iconSize: [containerSize, containerSize],
    iconAnchor: [containerSize / 2, containerSize / 2],
    popupAnchor: [0, -containerSize / 2],
  });
}

export const iconHome = createDivIcon(<Home size={28} />, "map-home", 36);
const iconPackage = createDivIcon(<Package size={24} />, "map-parcel", 32);
const iconTruck = createDivIcon(<Truck size={24} />, "map-truck", 32);
export const iconVan = createDivIcon(<Van size={24} />, "map-van", 32);
const iconPlane = createDivIcon(<Plane size={24} />, "map-plane", 32);
const iconShip = createDivIcon(<Ship size={24} />, "map-ship", 32);
const iconTrain = createDivIcon(<Train size={24} />, "map-train", 32);
export const iconSource = createDivIcon(<MapPin size={24} />, "map-start", 28);
export const iconIntermediate = createDivIcon(<MapPin size={20} />, "map-stop", 24);
/** A stop placed from its place name only: hollow and fainter, as its spot is a town's centre. */
export const iconApproximate = createDivIcon(
  <MapPin size={20} strokeDasharray="3 2" opacity={0.75} />,
  "map-stop",
  24,
);
const iconHeli = createDivIcon(<Helicopter size={24} />, "map-heli", 32);
const iconBike = createDivIcon(<Bike size={24} />, "map-bike", 32);

const TRANSPORT_ICONS: Readonly<Record<string, L.DivIcon>> = {
  plane: iconPlane,
  flight: iconPlane,
  ship: iconShip,
  boat: iconShip,
  train: iconTrain,
  rail: iconTrain,
  truck: iconTruck,
  van: iconVan,
  heli: iconHeli,
  helicopter: iconHeli,
  bike: iconBike,
  bicycle: iconBike,
};

export function getTransportMarkerIcon(method?: string): L.DivIcon {
  return TRANSPORT_ICONS[method?.toLowerCase() ?? ""] ?? iconPackage;
}

/**
 * Whole words or phrases in the carrier's text: "transport" is not "port", "shipment" not
 * "ship". German compounds are listed as they are written.
 */
const TRANSPORT_WORDS: readonly [string, readonly string[]][] = [
  [
    "plane",
    ["plane", "flight", "aircraft", "airplane", "air freight", "luftfracht", "flugzeug", "flying"],
  ],
  ["ship", ["ship", "boat", "schiff", "ocean", "sea freight", "seefracht", "vessel", "container"]],
  ["heli", ["helicopter", "hubschrauber"]],
  ["train", ["train", "rail", "bahn", "railway"]],
  ["bike", ["bike", "bicycle", "fahrrad", "cycling", "radfahrer"]],
  ["van", ["van", "delivery vehicle", "zustellfahrzeug", "delivery", "courier", "filiale"]],
  ["truck", ["truck", "lkw", "hauler", "laster", "freight", "cargo", "transit", "sorting"]],
];

function hasWord(text: string, word: string): boolean {
  const isLetter = (char: string): boolean => /\p{L}/u.test(char);
  let from = text.indexOf(word);
  while (from !== -1) {
    const before = from === 0 ? "" : text.charAt(from - 1);
    const after = text.charAt(from + word.length);
    if (!isLetter(before) && !isLetter(after)) return true;
    from = text.indexOf(word, from + 1);
  }
  return false;
}

/** Guesses how a parcel travels from its newest history text. */
export function determineTransportMethod(
  events: readonly { readonly raw_status: string; readonly timestamp: string }[],
): string {
  const newestFirst = [...events].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  for (const event of newestFirst) {
    const text = event.raw_status.toLowerCase();
    const match = TRANSPORT_WORDS.find(([, words]) => words.some((word) => hasWord(text, word)));
    if (match !== undefined) {
      return match[0];
    }
  }
  return "unknown";
}

/** A quadratic Bézier curve between two coordinates, bowed to one side. */
function getBezierCurve(start: LatLng, end: LatLng, segments = 50): LatLng[] {
  const [lat1, lng1] = start;
  const [lat2, lng2] = end;
  const dLat = lat2 - lat1;
  const dLng = lng2 - lng1;
  const dist = Math.sqrt(dLat * dLat + dLng * dLng);
  if (dist < 0.001) {
    return [start, end];
  }
  const offset = dist * 0.2;
  const cx = (lat1 + lat2) / 2 - dLng * (offset / dist);
  const cy = (lng1 + lng2) / 2 + dLat * (offset / dist);
  const points: LatLng[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const inv = 1 - t;
    points.push([
      inv * inv * lat1 + 2 * inv * t * cx + t * t * lat2,
      inv * inv * lng1 + 2 * inv * t * cy + t * t * lng2,
    ]);
  }
  return points;
}

/** Joins several points with curves. */
export function generateCurvedPath(points: readonly LatLng[], segmentsPerCurve = 25): LatLng[] {
  if (points.length < 2) {
    return [...points];
  }
  const path: LatLng[] = [];
  points.slice(0, -1).forEach((point, index) => {
    const next = points[index + 1];
    if (next === undefined) {
      return;
    }
    const curve = getBezierCurve(point, next, segmentsPerCurve);
    path.push(...(index < points.length - 2 ? curve.slice(0, -1) : curve));
  });
  return path;
}
