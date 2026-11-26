import type { ReactNode } from "react";
import type { GetApiV1Status200, GetApiV1Status200ConnectionsItem } from "../api/generated";
import { useDiagnostics, useStatus } from "../api/queries";
import { useIsAdmin } from "../auth/session";
import { ErrorNotice, ReadOnlyHint, Spinner } from "../components/ui";
import { formatDateTime, formatRelative } from "../lib/format";
import { t } from "../i18n";
import { ConnectionStateBadge } from "../parcels/badges";
import { StateCause } from "../connections/StateCause";
import { lastDelivery } from "../consumers/delivery";

type CheckState = GetApiV1Status200["status"];
type CheckName = keyof GetApiV1Status200["checks"];

const STATE_LABELS: Readonly<Record<CheckState, string>> = t.admin.status.states;

const CHECK_LABELS: Readonly<Record<CheckName, string>> = t.admin.status.checks;

function download(data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `open-parcels-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function CheckBadge({ state }: { readonly state: CheckState }): ReactNode {
  return <span className={`badge check-${state}`}>{STATE_LABELS[state]}</span>;
}

function ConnectionLine(props: {
  readonly connection: GetApiV1Status200ConnectionsItem;
  readonly extra?: string;
}): ReactNode {
  const { connection } = props;
  return (
    <li>
      <ConnectionStateBadge state={connection.state} lastOkAt={connection.last_ok_at} />{" "}
      <strong>{connection.label}</strong>{" "}
      <span className="muted">
        {t.admin.status.connectionLine(
          props.extra,
          formatRelative(connection.last_run_at),
          formatRelative(connection.last_ok_at),
        )}
        {connection.backoff_until === null
          ? null
          : t.admin.status.pausedUntil(formatDateTime(connection.backoff_until))}
      </span>
      <StateCause
        reason={connection.state_reason}
        carrierMessage={connection.carrier_message}
        as="div"
      />
    </li>
  );
}

function Overview({ status }: { readonly status: GetApiV1Status200 }): ReactNode {
  return (
    <section className="card" aria-labelledby="health-title">
      <h2 id="health-title">{t.admin.status.service}</h2>
      <p role="status">
        <CheckBadge state={status.status} />{" "}
        <span className="muted">
          {t.admin.status.version(status.version, status.commit, formatDateTime(status.started_at))}
        </span>
      </p>
      <ul className="plain-list">
        {(Object.keys(CHECK_LABELS) as CheckName[]).map((name) => (
          <li key={name}>
            <CheckBadge state={status.checks[name]} /> {CHECK_LABELS[name]}
          </li>
        ))}
      </ul>
      {status.database.detail === null ? null : (
        <p className="muted">{t.admin.status.databaseDetail(status.database.detail)}</p>
      )}
    </section>
  );
}

function Background({ status }: { readonly status: GetApiV1Status200 }): ReactNode {
  const { scheduler, event_stream: stream, backups } = status;
  return (
    <section className="card" aria-labelledby="background-title">
      <h2 id="background-title">{t.admin.status.background}</h2>
      <ul className="plain-list">
        <li>
          <CheckBadge state={status.checks.scheduler} />{" "}
          <strong>{t.admin.status.checks.scheduler}</strong>{" "}
          <span className="muted">
            {t.admin.status.scheduler(
              scheduler.running,
              scheduler.in_flight,
              formatRelative(scheduler.last_cycle_at),
              formatRelative(scheduler.next_run_at),
            )}
          </span>
          {scheduler.last_error === null ? null : (
            <div className="muted">{t.admin.status.schedulerErrors[scheduler.last_error]}</div>
          )}
        </li>
        <li>
          <CheckBadge state={status.checks.event_stream} />{" "}
          <strong>{t.admin.status.checks.event_stream}</strong>{" "}
          <span className="muted">
            {t.admin.status.stream(stream.clients, stream.stored, stream.live_sessions)}
          </span>
        </li>
        <li>
          <CheckBadge state={status.checks.backups} />{" "}
          <strong>{t.admin.status.checks.backups}</strong>{" "}
          <span className="muted">
            {backups.enabled
              ? t.admin.status.backupsNext(formatRelative(backups.next_at))
              : t.admin.status.backupsOff}
            {backups.last_at === null
              ? t.admin.status.backupsNone
              : t.admin.status.backupsLast(
                  formatRelative(backups.last_at),
                  backups.last_ok === true,
                )}
          </span>
          {backups.last_error === null ? null : (
            <div className="muted">{t.admin.backupErrors[backups.last_error]}</div>
          )}
        </li>
      </ul>
    </section>
  );
}

export function StatusPage(): ReactNode {
  const status = useStatus();
  const admin = useIsAdmin();
  const data = status.data;

  return (
    <section aria-labelledby="status-title">
      <div className="page-header">
        <h1 id="status-title">{t.admin.status.title}</h1>
      </div>
      <ErrorNotice error={status.error} />
      {data === undefined ? (
        <Spinner />
      ) : (
        <>
          <Overview status={data} />
          <section className="card" aria-labelledby="connections-status-title">
            <h2 id="connections-status-title">{t.admin.status.checks.connections}</h2>
            {data.connections.length === 0 ? (
              <p className="muted">{t.admin.status.noneYet}</p>
            ) : null}
            <ul className="plain-list">
              {data.connections.map((connection) => (
                <ConnectionLine key={connection.id} connection={connection} />
              ))}
            </ul>
          </section>
          <section className="card" aria-labelledby="inboxes-status-title">
            <h2 id="inboxes-status-title">{t.admin.status.checks.inboxes}</h2>
            {data.inboxes.length === 0 ? <p className="muted">{t.admin.status.noneYet}</p> : null}
            <ul className="plain-list">
              {data.inboxes.map((inbox) => (
                <ConnectionLine
                  key={inbox.id}
                  connection={inbox}
                  extra={
                    inbox.connected
                      ? t.admin.status.watching
                      : inbox.reconnect_at === null
                        ? t.admin.status.notConnected
                        : t.admin.status.reconnecting(formatRelative(inbox.reconnect_at))
                  }
                />
              ))}
            </ul>
          </section>
          <section className="card" aria-labelledby="consumers-status-title">
            <h2 id="consumers-status-title">{t.admin.status.checks.consumers}</h2>
            {data.consumers.length === 0 ? <p className="muted">{t.admin.status.noneYet}</p> : null}
            <ul className="plain-list">
              {data.consumers.map((consumer) => (
                <li key={consumer.id}>
                  <CheckBadge
                    state={consumer.enabled && consumer.last_error !== null ? "degraded" : "ok"}
                  />{" "}
                  <strong>{consumer.label}</strong>{" "}
                  <span className="muted">
                    {consumer.enabled ? lastDelivery(consumer) : t.consumers.off}
                    {t.admin.status.consumerQueue(consumer.pending, consumer.failed)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <Background status={data} />
        </>
      )}
      <section className="card" aria-labelledby="diag-title">
        <h2 id="diag-title">{t.admin.status.diagnostics}</h2>
        {admin ? (
          <Diagnostics />
        ) : (
          <ReadOnlyHint>{t.admin.status.diagnosticsAdminOnly}</ReadOnlyHint>
        )}
      </section>
    </section>
  );
}

/** Only mounted for the admin, so readers do not ask for what they may not see. */
function Diagnostics(): ReactNode {
  const diagnostics = useDiagnostics();
  return (
    <>
      <p className="muted">{t.admin.status.redacted}</p>
      <ErrorNotice error={diagnostics.error} />
      <div className="actions">
        <button
          type="button"
          className="button"
          disabled={diagnostics.data === undefined}
          onClick={() => {
            download(diagnostics.data);
          }}
        >
          {t.admin.status.download}
        </button>
      </div>
      {diagnostics.data === undefined ? null : (
        <details>
          <summary>{t.admin.status.show}</summary>
          <pre className="diagnostics">{JSON.stringify(diagnostics.data, null, 2)}</pre>
        </details>
      )}
    </>
  );
}
