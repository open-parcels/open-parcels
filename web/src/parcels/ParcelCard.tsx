/** The original UI's parcel card: carrier tile, name, last carrier text, ETA and a status tag. */
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { Parcel } from "../api/types";
import { CarrierLogo, useProviderName } from "../components/CarrierLogo";
import { deliveryLine } from "../lib/format";
import { LookupBadge, StatusBadge } from "./badges";
import { t } from "../i18n";

/** "Expected Thu 20 Nov", "4 stops away", "Delivered 2 hours ago", or nothing. */
function etaText(parcel: Parcel): string | null {
  const stops = parcel.live?.stops_away;
  if (!parcel.delivered && typeof stops === "number") {
    return stops === 0 ? t.parcels.nextStop : t.parcels.stopsAway(stops);
  }
  return deliveryLine(parcel);
}

export function ParcelCard({ parcel }: { readonly parcel: Parcel }): ReactNode {
  const eta = etaText(parcel);
  const carrierName = useProviderName(parcel.carrier);
  return (
    <Link to="/parcels/$parcelId" params={{ parcelId: parcel.id }} className="parcel-card">
      <CarrierLogo carrier={parcel.carrier} />
      <div className="parcel-card-body">
        <div className="parcel-card-title">{parcel.display_name}</div>
        <div className="parcel-card-meta">
          {parcel.raw_status ?? `${carrierName} · ${parcel.tracking_number}`}
        </div>
        {eta === null ? null : <div className="parcel-card-eta">{eta}</div>}
      </div>
      {parcel.lookup.state === "not_found" ? (
        <LookupBadge state="not_found" />
      ) : (
        <StatusBadge status={parcel.status} manual={parcel.manual_status !== null} />
      )}
    </Link>
  );
}
