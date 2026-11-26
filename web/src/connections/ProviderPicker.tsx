import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { LogoTile } from "../components/CarrierLogo";
import { t } from "../i18n";
import { countryName, searchEntries, type PickerEntry } from "./picker";

/** Badges shown per row; the rest is summed up as "+3" (all names are read out in full). */
const MAX_BADGES = 4;

/** Moves focus between the rows with the arrow keys, Home and End. */
function moveFocus(list: HTMLElement | null, event: KeyboardEvent<HTMLElement>): void {
  const rows = [...(list?.querySelectorAll<HTMLButtonElement>("button.picker-row") ?? [])];
  if (rows.length === 0) {
    return;
  }
  const index = rows.findIndex((row) => row === document.activeElement);
  const target: Readonly<Record<string, number>> = {
    ArrowDown: index < 0 ? 0 : Math.min(index + 1, rows.length - 1),
    ArrowUp: Math.max(index - 1, 0),
    Home: 0,
    End: rows.length - 1,
  };
  const next = target[event.key];
  if (next !== undefined) {
    event.preventDefault();
    rows[next]?.focus();
  }
}

function Row(props: {
  readonly entry: PickerEntry;
  readonly onChoose: (id: string) => void;
}): ReactNode {
  const { entry } = props;
  const shown = entry.countries.slice(0, MAX_BADGES);
  const more = entry.countries.length - shown.length;
  return (
    <li>
      <button
        type="button"
        className="picker-row"
        onClick={() => {
          props.onChoose(entry.id);
        }}
      >
        <LogoTile carrier={entry.id} name={entry.name} logo={entry.logo} size={36} />
        <span className="picker-name">{entry.name}</span>
        <span className="picker-badges" aria-hidden="true">
          {shown.map((code) => (
            <span key={code} className="picker-badge">
              {code === "*" ? t.connections.worldwide : code}
            </span>
          ))}
          {more > 0 ? <span className="picker-badge">+{more}</span> : null}
        </span>
        {entry.countries.length > 0 ? (
          <span className="visually-hidden">
            {`, ${entry.countries.map((code) => countryName(code)).join(", ")}`}
          </span>
        ) : null}
        <span className="picker-chevron" aria-hidden="true">
          ›
        </span>
      </button>
    </li>
  );
}

function Section(props: {
  readonly title: string;
  readonly entries: readonly PickerEntry[];
  readonly onChoose: (id: string) => void;
}): ReactNode {
  const headingId = useId();
  if (props.entries.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="picker-heading">
        {props.title}
      </h3>
      <ul className="picker-list">
        {props.entries.map((entry) => (
          <Row key={entry.id} entry={entry} onChoose={props.onChoose} />
        ))}
      </ul>
    </section>
  );
}

/** The picker's own texts; "Add a consumer" brings its own. */
export interface PickerLabels {
  readonly search: string;
  readonly main: string;
  readonly other: string;
}

const CONNECTION_LABELS: PickerLabels = {
  search: t.connections.pickerSearch,
  main: t.connections.pickerProviders,
  other: t.connections.pickerOther,
};

/**
 * The first step of "Add a connection", like Home Assistant's "Add integration": a search over
 * name, aliases and countries, one row per provider, inboxes and fallback services apart. "Add a
 * consumer" uses it too, with its own labels.
 */
export function ProviderPicker(props: {
  readonly entries: readonly PickerEntry[];
  readonly onChoose: (id: string) => void;
  readonly labels?: PickerLabels;
}): ReactNode {
  const labels = props.labels ?? CONNECTION_LABELS;
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const statusId = useId();
  const found = useMemo(() => searchEntries(props.entries, query), [props.entries, query]);
  const providers = found.filter((entry) => !entry.other);
  const other = found.filter((entry) => entry.other);

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = providers[0] ?? other[0];
      if (first !== undefined) {
        props.onChoose(first.id);
      }
    } else if (event.key === "ArrowDown") {
      moveFocus(listRef.current, event);
    }
  };

  return (
    <div className="picker">
      <label htmlFor={inputId} className="visually-hidden">
        {labels.search}
      </label>
      <input
        id={inputId}
        type="search"
        className="picker-search"
        placeholder={labels.search}
        autoComplete="off"
        // The dialog opens on this step: typing starts the search straight away.
        autoFocus
        value={query}
        aria-describedby={statusId}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
        onKeyDown={onSearchKey}
      />
      <p id={statusId} role="status" className="muted picker-status">
        {found.length === 0 ? t.connections.pickerNone : t.connections.pickerResults(found.length)}
      </p>
      <div
        ref={listRef}
        className="picker-results"
        onKeyDown={(event) => {
          moveFocus(listRef.current, event);
        }}
      >
        <Section title={labels.main} entries={providers} onChoose={props.onChoose} />
        <Section title={labels.other} entries={other} onChoose={props.onChoose} />
      </div>
    </div>
  );
}
