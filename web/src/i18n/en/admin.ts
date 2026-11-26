import type { BackupError, SchedulerError } from "../../api/types";

/** English texts: admin. The German file must have the same keys (the type enforces it). */
export const admin = {
  status: {
    title: "Status",
    states: { ok: "OK", degraded: "Needs attention", unavailable: "Unavailable" },
    checks: {
      database: "Database",
      connections: "Connections",
      inboxes: "Inboxes",
      scheduler: "Scheduler",
      event_stream: "Live event stream",
      backups: "Backups",
      consumers: "Consumers",
    },
    service: "Service",
    version: (version: string, commit: string | null, since: string) =>
      `Version ${version}${commit === null ? "" : ` (${commit})`}, running since ${since}`,
    databaseDetail: (detail: string) => `Database: ${detail}`,
    connectionLine: (extra: string | undefined, lastRun: string, lastOk: string) =>
      `${extra === undefined ? "" : `${extra}, `}last run ${lastRun}, last success ${lastOk}`,
    pausedUntil: (until: string) => `, paused by the carrier until ${until}`,
    background: "Background work",
    scheduler: (running: boolean, inFlight: number, lastPass: string, next: string) =>
      `${running ? "running" : "stopped"}, ${String(inFlight)} runs in progress, last pass ${lastPass}, next run ${next}`,
    stream: (clients: number, stored: number, live: number) =>
      `${String(clients)} clients connected, ${String(stored)} events kept for replay, ${String(live)} couriers followed live`,
    backupsNext: (next: string) => `next ${next}`,
    backupsOff: "automatic backups off",
    backupsNone: ", none yet",
    backupsLast: (when: string, ok: boolean) => `, last ${when} (${ok ? "succeeded" : "failed"})`,
    consumerQueue: (pending: number, failed: number) =>
      (pending > 0 ? `, ${String(pending)} waiting` : "") +
      (failed > 0 ? `, ${String(failed)} given up` : ""),
    noneYet: "None yet.",
    watching: "watching for new email",
    notConnected: "not connected",
    reconnecting: (when: string) => `reconnecting ${when}`,
    diagnostics: "Diagnostics",
    diagnosticsAdminOnly: "Diagnostics are for the admin only.",
    redacted: "Redacted on the server: no tracking numbers, addresses or sign-in data.",
    download: "Download diagnostics",
    show: "Show",
    schedulerErrors: {
      cycle_failed: "The last pass failed; the server log says why.",
    } satisfies Record<SchedulerError, string>,
  },
  backupErrors: {
    no_space: "The disk is full.",
    permission_denied: "The server may not write to the backup folder.",
    read_only: "The backup folder is on a read-only file system.",
    not_a_folder: "The backup folder path is not a folder.",
    failed: "The backup failed; the server log says why.",
  } satisfies Record<BackupError, string>,
  tokens: {
    title: "API tokens",
    adminOnly: "API tokens are for the admin only.",
    newToken: "New token",
    name: "Name",
    nameHint: "What uses it, for example “Home Assistant”.",
    scopes: "Scopes",
    scopeNames: { read: "read", write: "write", admin: "admin" },
    create: "Create token",
    copyNow: "Copy the token now. It is shown",
    onlyOnce: "only once",
    copyNowEnd: ".",
    copied: "Copied.",
    copyUnavailable: "Copying is not available here: the token is selected, copy it by hand.",
    copy: "Copy",
    done: "Done",
    created: "Created",
    lastUsed: "Last used",
    actions: "Actions",
    none: "No tokens yet.",
    revokeConfirm: (name: string) => `Revoke the token “${name}”?`,
    revoke: "Revoke",
    logins: "Logins",
    loginsHint:
      "Apps and web UIs elsewhere that logged in with a password. They end on their own after 30 days without use, and when the password changes.",
    role: "Role",
    roleNames: { admin: "admin", reader: "reader" },
    expires: "Ends",
    noLogins: "No logins.",
    endConfirm: (name: string) => `Log out “${name}”?`,
    end: "Log out",
  },
};
