import { ItemPictures } from "../components/ItemPictures";
import { Segmented } from "../components/Segmented";
import { Link } from "@tanstack/react-router";
import { createColumnHelper, type SortingState } from "@tanstack/react-table";
import type { ReactNode } from "react";
import type { Parcel } from "../api/types";
import { CarrierLogo, ProviderName, useProviderNames } from "../components/CarrierLogo";
import { DataTable, type TableSearch } from "../components/DataTable";
import { formatRelative, formatExpected } from "../lib/format";
import { ArchivedBadge, LookupBadge, StatusBadge } from "./badges";
import { t } from "../i18n";

export const PARCEL_FILTERS = ["active", "delivered", "all"] as const;
export type ParcelFilter = (typeof PARCEL_FILTERS)[number];

const FILTER_LABELS: Readonly<Record<ParcelFilter, string>> = {
  active: t.parcels.filterActive,
  delivered: t.parcels.filterDelivered,
  all: t.parcels.filterAll,
};

const column = createColumnHelper<Parcel>();

const COLUMNS = [
  column.accessor((parcel) => parcel.display_name, {
    id: "name",
    header: t.parcels.columnParcel,
    cell: (info) => (
      <Link
        to="/parcels/$parcelId"
        params={{ parcelId: info.row.original.id }}
        className="row-link"
      >
        <CarrierLogo carrier={info.row.original.carrier} size={32} />
        <span className="cell-title">
          <strong>{info.getValue()}</strong>
          {info.row.original.label === null ? null : (
            <span className="mono"> {info.row.original.tracking_number}</span>
          )}
          {info.row.original.archived_at === null ? null : (
            <>
              {" "}
              <ArchivedBadge />
            </>
          )}
        </span>
        <ItemPictures items={info.row.original.items} limit={3} size="small" />
      </Link>
    ),
  }),
  column.accessor("status", {
    id: "status",
    header: t.parcels.columnStatus,
    // `status` is already the effective one: a manual status wins on the server.
    cell: (info) => (
      <StatusBadge status={info.getValue()} manual={info.row.original.manual_status !== null} />
    ),
  }),
  column.accessor((parcel) => parcel.lookup.state, {
    id: "lookup",
    header: t.parcels.columnLookup,
    cell: (info) => <LookupBadge state={info.getValue()} />,
  }),
  column.accessor("carrier", {
    id: "carrier",
    header: t.parcels.columnCarrier,
    cell: (info) => <ProviderName id={info.getValue()} />,
  }),
  column.accessor((parcel) => parcel.expected_from ?? parcel.expected_to ?? "", {
    id: "expected",
    header: t.parcels.columnEta,
    cell: (info) => formatExpected(info.row.original),
  }),
  column.accessor("updated_at", {
    id: "updated_at",
    header: t.parcels.columnUpdated,
    cell: (info) => <time dateTime={info.getValue()}>{formatRelative(info.getValue())}</time>,
  }),
];

/** The columns the server sorts by (`sort` of `GET /api/v1/parcels`). */
export const PARCEL_SORT_COLUMNS = [
  "name",
  "status",
  "lookup",
  "carrier",
  "expected",
  "updated_at",
] as const;

export const PARCEL_DEFAULT_SORT: SortingState = [{ id: "updated_at", desc: true }];

/**
 * The parcel list: rows the server searched, filtered, sorted and paged. The Show filter is owned
 * by the page, so it survives the table being re-rendered with another data set (archived parcels
 * included or not).
 */
export function ParcelTable(props: {
  readonly parcels: Parcel[];
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly onMore: () => void;
  readonly filter: ParcelFilter;
  readonly onFilterChange: (filter: ParcelFilter) => void;
  readonly carrier: string;
  readonly carriers: readonly string[];
  readonly onCarrierChange: (carrier: string) => void;
  readonly sorting: SortingState;
  readonly onSortingChange: (next: SortingState) => void;
  readonly search: TableSearch;
}): ReactNode {
  const { filter, onFilterChange: setFilter, carrier } = props;
  const nameOf = useProviderNames();
  const controls = (
    <>
      <Segmented
        legend={t.parcels.show}
        name="parcel-filter"
        options={PARCEL_FILTERS.map((value) => ({
          value,
          label: FILTER_LABELS[value],
        }))}
        value={filter}
        onChange={setFilter}
      />
      <label>
        <span className="visually-hidden">{t.parcels.carrier}</span>
        <select
          value={carrier}
          onChange={(e) => {
            props.onCarrierChange(e.target.value);
          }}
        >
          <option value="">{t.parcels.allCarriers}</option>
          {props.carriers.map((id) => (
            <option key={id} value={id}>
              {nameOf(id)}
            </option>
          ))}
        </select>
      </label>
    </>
  );

  return (
    <DataTable
      caption={t.parcels.title}
      columns={COLUMNS}
      data={props.parcels}
      hasMore={props.hasMore}
      loadingMore={props.loadingMore}
      onMore={props.onMore}
      searchLabel={t.parcels.searchParcels}
      extraControls={controls}
      sorting={props.sorting}
      onSortingChange={props.onSortingChange}
      search={props.search}
      emptyText={filter === "active" ? t.parcels.noneOnTheWay : t.parcels.none}
      rowClassName={(parcel) => (parcel.lookup.state === "not_found" ? "row-warning" : undefined)}
    />
  );
}
