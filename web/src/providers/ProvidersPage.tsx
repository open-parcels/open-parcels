import { useState, type ReactNode } from "react";
import {
  useAvailableItems,
  useInstalledItems,
  useRefreshAvailable,
  useSetAutoUpdate,
  useUninstallItem,
} from "../api/installs";
import type { AvailableItem, InstalledItem, InstallSource } from "../api/types";
import { useIsAdmin } from "../auth/session";
import { Segmented } from "../components/Segmented";
import { ErrorNotice, ReadOnlyHint, Spinner } from "../components/ui";
import { t } from "../i18n";
import { formatRelative } from "../lib/format";
import { InstallDialog } from "./InstallDialog";

type Tab = "installed" | "available";
type Source = "verified" | "community";
type Tier = InstalledItem["tier"];

function TierBadge({ tier }: { readonly tier: Tier }): ReactNode {
  return (
    <span className={`badge tier-${tier}`} title={t.providers.tierHint[tier]}>
      {tier === "community" ? "⚠ " : null}
      {t.providers.tier[tier]}
    </span>
  );
}

function InstalledRow(props: { readonly item: InstalledItem; readonly admin: boolean }): ReactNode {
  const { item } = props;
  const autoUpdate = useSetAutoUpdate();
  const uninstall = useUninstallItem();
  return (
    <li className={`card stack install-${item.tier}`}>
      <div>
        <strong>{item.name}</strong> <span className="badge">{t.providers.kind[item.kind]}</span>{" "}
        <TierBadge tier={item.tier} />
      </div>
      {item.repository === null ? null : (
        <p className="muted">
          {item.repository}
          {item.version === null ? null : ` · ${t.providers.version(item.version)}`}
        </p>
      )}
      <div className="actions">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={item.auto_update}
            disabled={item.auto_update_fixed || !props.admin || autoUpdate.isPending}
            onChange={(event) => {
              autoUpdate.mutate({ kind: item.kind, id: item.id, on: event.target.checked });
            }}
          />
          {item.auto_update_fixed ? t.providers.autoUpdateFixed : t.providers.autoUpdate}
        </label>
        {props.admin && item.tier !== "builtin" ? (
          <button
            type="button"
            className="button"
            disabled={uninstall.isPending}
            onClick={() => {
              if (window.confirm(t.providers.uninstallQuestion(item.name))) {
                uninstall.mutate({ kind: item.kind, id: item.id });
              }
            }}
          >
            {t.providers.uninstall}
          </button>
        ) : null}
      </div>
      <ErrorNotice error={autoUpdate.error ?? uninstall.error} />
    </li>
  );
}

function InstalledTab(props: { readonly admin: boolean; readonly query: string }): ReactNode {
  const installed = useInstalledItems();
  const data = installed.data;
  if (data === undefined)
    return installed.isPending ? <Spinner /> : <ErrorNotice error={installed.error} />;
  const needle = props.query.trim().toLowerCase();
  const items = data.items.filter(
    (item) => needle === "" || `${item.name} ${item.id}`.toLowerCase().includes(needle),
  );
  return (
    <div className="stack">
      {data.remote ? null : <p className="notice notice-warning">{t.providers.remoteOff}</p>}
      {data.registry.error === null ? null : (
        <p className="notice notice-warning">{t.providers.registryError(data.registry.error)}</p>
      )}
      {data.registry.stale_days > 0 ? (
        <p className="notice notice-warning">
          {t.providers.registryStale(data.registry.stale_days)}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="muted">{t.providers.empty}</p>
      ) : (
        <ul className="plain-list stack">
          {items.map((item) => (
            <InstalledRow key={`${item.kind}/${item.id}`} item={item} admin={props.admin} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AvailableRow(props: {
  readonly item: AvailableItem;
  readonly admin: boolean;
  readonly onCheck: (item: AvailableItem) => void;
}): ReactNode {
  const { item } = props;
  return (
    <li className={`card stack install-${item.tier}`}>
      <div>
        <strong>{item.name}</strong>{" "}
        {item.kind === null ? null : <span className="badge">{t.providers.kind[item.kind]}</span>}{" "}
        <TierBadge tier={item.tier} />{" "}
        {item.stars === null ? null : (
          <span className="muted">{t.providers.stars(item.stars)}</span>
        )}
      </div>
      {item.description === null ? null : <p className="muted">{item.description}</p>}
      <p className="muted">
        {item.repository}
        {item.version === null ? null : ` · ${t.providers.version(item.version)}`}
      </p>
      {item.similar_to === null ? null : (
        <p className="notice notice-warning">{t.providers.similarTo(item.similar_to)}</p>
      )}
      {props.admin ? (
        <div className="actions">
          <button
            type="button"
            className="button"
            disabled={item.installed}
            onClick={() => {
              props.onCheck(item);
            }}
          >
            {item.installed ? t.providers.installed : t.providers.details}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function AvailableTab(props: {
  readonly admin: boolean;
  readonly query: string;
  readonly onCheck: (item: AvailableItem) => void;
}): ReactNode {
  const [source, setSource] = useState<Source>("verified");
  const available = useAvailableItems(source, true);
  const refresh = useRefreshAvailable();
  const data = available.data;
  const needle = props.query.trim().toLowerCase();
  const items = (data?.items ?? []).filter(
    (item) => needle === "" || `${item.name} ${item.repository}`.toLowerCase().includes(needle),
  );
  const checked = data?.checked_at ?? null;
  return (
    <div className="stack">
      <div className="actions">
        <Segmented
          legend={t.providers.sourceLegend}
          name="install-source"
          options={[
            { value: "verified", label: t.providers.source.verified },
            { value: "community", label: t.providers.source.community },
          ]}
          value={source}
          onChange={setSource}
        />
        <button
          type="button"
          className="button"
          disabled={refresh.isPending}
          onClick={() => {
            refresh.mutate(source);
          }}
        >
          {t.providers.refresh}
        </button>
      </div>
      <p className="muted">{t.providers.tierHint[source]}</p>
      <ErrorNotice error={available.error ?? refresh.error} />
      {data?.error === null || data === undefined ? null : (
        <p className="notice notice-warning">
          {source === "community"
            ? t.providers.communityError(data.error)
            : t.providers.registryError(data.error)}
        </p>
      )}
      {data === undefined ? (
        available.isPending ? (
          <Spinner />
        ) : null
      ) : items.length === 0 ? (
        <p className="muted">
          {source === "verified" ? t.providers.verifiedEmpty : t.providers.empty}
        </p>
      ) : (
        <ul className="plain-list stack">
          {items.map((item) => (
            <AvailableRow
              key={item.repository + (item.id ?? "")}
              item={item}
              admin={props.admin}
              onCheck={props.onCheck}
            />
          ))}
        </ul>
      )}
      {checked === null ? null : (
        <p className="muted">
          {source === "community"
            ? t.providers.communityChecked(formatRelative(checked))
            : t.providers.registryChecked(formatRelative(checked))}
        </p>
      )}
    </div>
  );
}

/** Providers, themes and consumers: installed and available, tiers, install and auto-update. */
export function ProvidersPage(): ReactNode {
  const admin = useIsAdmin();
  const [tab, setTab] = useState<Tab>("installed");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<{
    url?: string;
    ref?: string;
    source: InstallSource;
  } | null>(null);
  return (
    <section aria-labelledby="providers-title">
      <div className="page-header">
        <h1 id="providers-title">{t.providers.title}</h1>
        {admin ? (
          <button
            type="button"
            className="button primary"
            onClick={() => {
              setDialog({ source: "url" });
            }}
          >
            {t.providers.installFromUrl}
          </button>
        ) : null}
      </div>
      <p className="muted">{t.providers.intro}</p>
      {admin ? null : <ReadOnlyHint />}
      <div className="actions">
        <Segmented
          legend={t.providers.tabsLegend}
          name="providers-tab"
          options={[
            { value: "installed", label: t.providers.tabs.installed },
            { value: "available", label: t.providers.tabs.available },
          ]}
          value={tab}
          onChange={setTab}
        />
        <input
          type="search"
          aria-label={t.providers.search}
          placeholder={t.providers.search}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
      </div>
      {tab === "installed" ? (
        <InstalledTab admin={admin} query={query} />
      ) : (
        <AvailableTab
          admin={admin}
          query={query}
          onCheck={(item) => {
            setDialog({
              url: item.repository,
              ...(item.commit === null ? {} : { ref: item.commit }),
              source: item.tier,
            });
          }}
        />
      )}
      {dialog === null ? null : (
        <InstallDialog
          {...(dialog.url === undefined ? {} : { initialUrl: dialog.url })}
          {...(dialog.ref === undefined ? {} : { initialRef: dialog.ref })}
          source={dialog.source}
          onClose={() => {
            setDialog(null);
          }}
        />
      )}
    </section>
  );
}
