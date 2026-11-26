import { Package, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useParcelCounts, useParcels } from "../api/queries";
import type { GetApiV1ParcelsSort } from "../api/generated";
import { useIsAdmin } from "../auth/session";
import { useTableSearch, useTableSort } from "../components/DataTable";
import { ErrorNotice, Spinner } from "../components/ui";
import { formatNumber } from "../lib/locale";
import { AddParcelDialog } from "./AddParcelDialog";
import { flag, pickOne, useUrlParam } from "../lib/urlState";
import {
  PARCEL_DEFAULT_SORT,
  PARCEL_FILTERS,
  PARCEL_SORT_COLUMNS,
  ParcelTable,
  type ParcelFilter,
} from "./ParcelTable";
import { t } from "../i18n";

/**
 * Linkable: `?status=active|delivered|all`, `?archived=1`, `?carrier=dhl`, `?q=…`,
 * `?sort=-updated_at`. The server filters, searches, sorts and pages; "Show more" loads the next
 * page.
 */
export function ParcelsPage(): ReactNode {
  const [archivedParam, setArchivedParam] = useUrlParam("archived");
  const [statusParam, setStatusParam] = useUrlParam("status");
  const archived = flag(archivedParam);
  const filter = pickOne(statusParam, PARCEL_FILTERS, "active");
  const setArchived = (value: boolean): void => {
    setArchivedParam(value ? "1" : null);
  };
  const setFilter = (value: ParcelFilter): void => {
    setStatusParam(value === "active" ? null : value);
  };
  const [carrierParam, setCarrierParam] = useUrlParam("carrier");
  const carrier = carrierParam?.toLowerCase() ?? "";
  const [sorting, setSorting] = useTableSort("sort", PARCEL_SORT_COLUMNS, PARCEL_DEFAULT_SORT);
  const search = useTableSearch("q");
  const [adding, setAdding] = useState(false);
  const admin = useIsAdmin();
  const sort = sorting[0] ?? { id: "updated_at", desc: true };
  const parcels = useParcels({
    archived,
    active: filter === "all" ? undefined : filter === "active",
    carrier,
    search: search.applied,
    sort: `${sort.desc ? "-" : ""}${sort.id}` as GetApiV1ParcelsSort,
  });
  const carriers = useParcelCounts().data?.carriers.map((entry) => entry.carrier) ?? [];
  const list = parcels.data?.pages.flat();

  return (
    <section aria-labelledby="parcels-title" className="stack">
      <div className="page-header glass-panel">
        <div className="page-title-row">
          <Package size={22} className="page-icon" aria-hidden="true" />
          <h1 id="parcels-title">{t.parcels.title}</h1>
          {list === undefined ? null : (
            <span className="page-count">
              {formatNumber(list.length)}
              {parcels.hasNextPage ? "+" : ""}
            </span>
          )}
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => {
              setArchived(e.target.checked);
            }}
          />
          {t.parcels.includeArchived}
        </label>
        {/* Readers cannot add parcels: the button would only lead to a refusal. */}
        {admin ? (
          <button
            type="button"
            className="button primary"
            onClick={() => {
              setAdding(true);
            }}
          >
            <Plus size={16} aria-hidden="true" />
            {t.parcels.track}
          </button>
        ) : null}
      </div>
      <ErrorNotice error={parcels.error} />
      {list === undefined ? (
        parcels.isPending ? (
          <Spinner />
        ) : null
      ) : (
        <ParcelTable
          parcels={list}
          hasMore={parcels.hasNextPage}
          loadingMore={parcels.isFetchingNextPage}
          onMore={() => {
            void parcels.fetchNextPage();
          }}
          filter={filter}
          onFilterChange={setFilter}
          carrier={carrier}
          // The carrier in the address stays choosable while no parcel of it is left.
          carriers={
            carrier === "" || carriers.includes(carrier) ? carriers : [...carriers, carrier]
          }
          onCarrierChange={(value) => {
            setCarrierParam(value === "" ? null : value);
          }}
          sorting={sorting}
          onSortingChange={setSorting}
          search={search}
        />
      )}
      <AddParcelDialog
        open={adding}
        onClose={() => {
          setAdding(false);
        }}
      />
    </section>
  );
}
