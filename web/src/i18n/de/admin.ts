import type { Messages } from "../messages";

export const admin: Messages["admin"] = {
  status: {
    title: "Status",
    states: { ok: "OK", degraded: "Braucht Aufmerksamkeit", unavailable: "Nicht verfügbar" },
    checks: {
      database: "Datenbank",
      connections: "Verbindungen",
      inboxes: "Postfächer",
      scheduler: "Planer",
      event_stream: "Live-Ereignisstrom",
      backups: "Sicherungen",
      consumers: "Ausgaben",
    },
    service: "Dienst",
    version: (version: string, commit: string | null, since: string) =>
      `Version ${version}${commit === null ? "" : ` (${commit})`}, läuft seit ${since}`,
    databaseDetail: (detail: string) => `Datenbank: ${detail}`,
    connectionLine: (extra: string | undefined, lastRun: string, lastOk: string) =>
      `${extra === undefined ? "" : `${extra}, `}letzter Lauf ${lastRun}, letzter Erfolg ${lastOk}`,
    pausedUntil: (until: string) => `, vom Paketdienst pausiert bis ${until}`,
    background: "Hintergrundarbeit",
    scheduler: (running: boolean, inFlight: number, lastPass: string, next: string) =>
      `${running ? "läuft" : "gestoppt"}, ${String(inFlight)} Läufe in Arbeit, letzter Durchgang ${lastPass}, nächster Lauf ${next}`,
    stream: (clients: number, stored: number, live: number) =>
      `${String(clients)} Clients verbunden, ${String(stored)} Ereignisse zum Nachspielen gespeichert, ${String(live)} Zusteller live verfolgt`,
    backupsNext: (next: string) => `nächste ${next}`,
    backupsOff: "automatische Sicherungen aus",
    backupsNone: ", noch keine",
    backupsLast: (when: string, ok: boolean) =>
      `, letzte ${when} (${ok ? "erfolgreich" : "fehlgeschlagen"})`,
    consumerQueue: (pending: number, failed: number) =>
      (pending > 0 ? `, ${String(pending)} wartend` : "") +
      (failed > 0 ? `, ${String(failed)} aufgegeben` : ""),
    noneYet: "Noch keine.",
    watching: "wartet auf neue E-Mails",
    notConnected: "nicht verbunden",
    reconnecting: (when: string) => `verbindet neu ${when}`,
    diagnostics: "Diagnose",
    diagnosticsAdminOnly: "Die Diagnose ist nur für den Admin.",
    redacted: "Auf dem Server geschwärzt: keine Sendungsnummern, Adressen oder Anmeldedaten.",
    download: "Diagnose herunterladen",
    show: "Anzeigen",
    schedulerErrors: {
      cycle_failed: "Der letzte Durchlauf ist fehlgeschlagen; das Server-Log nennt den Grund.",
    },
  },
  backupErrors: {
    no_space: "Der Datenträger ist voll.",
    permission_denied: "Der Server darf nicht in den Sicherungsordner schreiben.",
    read_only: "Der Sicherungsordner liegt auf einem schreibgeschützten Dateisystem.",
    not_a_folder: "Der Pfad des Sicherungsordners ist kein Ordner.",
    failed: "Die Sicherung ist fehlgeschlagen; das Server-Log nennt den Grund.",
  },
  tokens: {
    title: "API-Tokens",
    adminOnly: "API-Tokens sind nur für den Admin.",
    newToken: "Neuer Token",
    name: "Name",
    nameHint: "Was ihn verwendet, zum Beispiel „Home Assistant“.",
    scopes: "Berechtigungen",
    scopeNames: { read: "lesen", write: "schreiben", admin: "Admin" },
    create: "Token erstellen",
    copyNow: "Den Token jetzt kopieren. Er wird",
    onlyOnce: "nur einmal",
    copyNowEnd: " angezeigt.",
    copied: "Kopiert.",
    copyUnavailable:
      "Kopieren ist hier nicht möglich: Der Token ist markiert, bitte von Hand kopieren.",
    copy: "Kopieren",
    done: "Fertig",
    created: "Erstellt",
    lastUsed: "Zuletzt verwendet",
    actions: "Aktionen",
    none: "Noch keine Tokens.",
    revokeConfirm: (name: string) => `Den Token „${name}“ widerrufen?`,
    revoke: "Widerrufen",
    logins: "Logins",
    loginsHint:
      "Apps und Weboberflächen an anderer Stelle, die sich mit einem Passwort eingeloggt haben. Sie enden von selbst nach 30 Tagen ohne Nutzung und wenn sich das Passwort ändert.",
    role: "Rolle",
    roleNames: { admin: "Admin", reader: "Leser" },
    expires: "Endet",
    noLogins: "Keine Logins.",
    endConfirm: (name: string) => `„${name}“ ausloggen?`,
    end: "Ausloggen",
  },
};
