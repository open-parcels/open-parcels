import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";
import { ChevronDown, ChevronsUpDown, ChevronUp, Search } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useUrlParam } from "../lib/urlState";
import { t } from "../i18n";
import { formatNumber } from "../lib/locale";

/** How long typing pauses before the search goes to the address and the server. */
const SEARCH_DELAY_MS = 300;

export interface DataTableProps<TData> {
  /** Column definitions; build them with `createColumnHelper<TData>()`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TanStack's column helper yields ColumnDef<T, any>; the value type differs per column.
  readonly columns: ColumnDef<TData, any>[];
  /** The rows loaded so far, already searched, filtered and sorted by the server. */
  readonly data: TData[];
  /** Another page follows on the server: "Show more" loads it and the count reads "200+". */
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly onMore: () => void;
  readonly caption: string;
  readonly emptyText?: string;
  readonly searchLabel?: string;
  /** Controls placed beside the search box, such as filters. */
  readonly extraControls?: ReactNode;
  /** The sort the server applied, and how to change it (`useTableSort`). */
  readonly sorting: SortingState;
  readonly onSortingChange: (next: SortingState) => void;
  /** The search the server applied, and the box's text (`useTableSearch`). */
  readonly search: TableSearch;
  readonly rowClassName?: (row: TData) => string | undefined;
}

/** `-updated_at` → updated_at descending; one column, unknown columns are dropped. */
function parseSort(raw: string | null, ids: ReadonlySet<string>): SortingState | null {
  if (raw === null) return null;
  const part = raw.split(",")[0]?.trim() ?? "";
  const entry = { id: part.replace(/^-/, ""), desc: part.startsWith("-") };
  return ids.has(entry.id) ? [entry] : null;
}

function formatSort(sorting: SortingState): string | null {
  const entry = sorting[0];
  return entry === undefined ? null : `${entry.desc ? "-" : ""}${entry.id}`;
}

/** A table's sort kept in the address under `key`: `?sort=-updated_at`, `?sort=name`. */
export function useTableSort(
  key: string,
  ids: readonly string[],
  fallback: SortingState,
): [SortingState, (next: SortingState) => void] {
  const [sortParam, setSortParam] = useUrlParam(key);
  const sorting = parseSort(sortParam, new Set(ids)) ?? fallback;
  return [
    sorting,
    (next) => {
      // Clicking a sorted column a third time goes back to the default sort.
      setSortParam(next.length === 0 ? null : formatSort(next));
    },
  ];
}

export interface TableSearch {
  /** The search in the address, which the server applied. */
  readonly applied: string;
  /** The box's text, which reaches the address once typing pauses. */
  readonly draft: string;
  readonly setDraft: (text: string) => void;
}

/** A table's search kept in the address under `key` (`?q=…`), written once typing pauses. */
export function useTableSearch(key: string): TableSearch {
  const [searchParam, setSearchParam] = useUrlParam(key);
  const applied = searchParam ?? "";
  const [typed, setTyped] = useState({ text: applied, from: applied });
  // The address changed elsewhere (a link, the back button): the box follows it.
  const draft = typed.from === applied ? typed.text : applied;
  const setDraft = (text: string): void => {
    setTyped({ text, from: applied });
  };
  useEffect(() => {
    if (draft === applied) return undefined;
    const timer = setTimeout(() => {
      setSearchParam(draft);
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [draft, applied, setSearchParam]);
  return { applied, draft, setDraft };
}

function SortIcon({ sorted }: { readonly sorted: false | "asc" | "desc" }): ReactNode {
  if (sorted === false) {
    return <ChevronsUpDown size={12} className="sort-icon" aria-hidden="true" />;
  }
  const Icon = sorted === "asc" ? ChevronUp : ChevronDown;
  return <Icon size={12} className="sort-icon active" aria-hidden="true" />;
}

/**
 * A table of rows the server searched, filtered, sorted and paged. Headers are buttons, so
 * sorting works by keyboard; the sort and the search live in the address.
 */
export function DataTable<TData>(props: DataTableProps<TData>): ReactNode {
  const { sorting, search } = props;
  const setSorting = (updater: Updater<SortingState>): void => {
    props.onSortingChange(typeof updater === "function" ? updater(sorting) : updater);
  };
  const searchId = useId();
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table returns fresh functions on purpose.
  const table = useReactTable({
    data: props.data,
    columns: props.columns,
    state: { sorting },
    onSortingChange: setSorting,
    manualSorting: true,
    manualFiltering: true,
    enableMultiSort: false,
    getCoreRowModel: getCoreRowModel(),
  });
  const rows = table.getRowModel().rows;

  return (
    <div className="data-table">
      <div className="table-toolbar glass-panel">
        <label htmlFor={searchId} className="visually-hidden">
          {props.searchLabel ?? t.common.search}
        </label>
        <div className="search-wrap">
          <Search size={14} aria-hidden="true" />
          <input
            id={searchId}
            type="search"
            placeholder={`${props.searchLabel ?? t.common.search}…`}
            value={search.draft}
            onChange={(e) => {
              search.setDraft(e.target.value);
            }}
          />
        </div>
        {props.extraControls}
        <span className="count" aria-live="polite">
          {formatNumber(rows.length)}
          {props.hasMore ? "+" : ""}
        </span>
      </div>
      <div className="table-scroll glass-panel">
        <table>
          <caption className="visually-hidden">{props.caption}</caption>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const ariaSort =
                    sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none";
                  return (
                    <th key={header.id} scope="col" aria-sort={ariaSort}>
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          className="sort-button"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <SortIcon sorted={sorted} />
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={props.columns.length} className="muted empty">
                  {search.applied === ""
                    ? (props.emptyText ?? t.common.nothingYet)
                    : t.common.nothingMatches}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className={props.rowClassName?.(row.original)}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {props.hasMore ? (
        <button
          type="button"
          className="button show-more"
          disabled={props.loadingMore}
          onClick={props.onMore}
        >
          {t.common.loadMore}
        </button>
      ) : null}
    </div>
  );
}
