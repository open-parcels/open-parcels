import type { Messages } from "../messages";

export const jobs: Messages["jobs"] = {
  actions: "Aktionen",
  start: (label: string) => `${label}…`,
  confirmDestructive: (label: string) => `Gib „${label}“ zur Bestätigung ein.`,
  inputTitle: (label: string) => label,
  startButton: "Starten",
  cancel: "Abbrechen",
  resume: "Fortsetzen",
  restart: "Neu beginnen",
  restartQuestion:
    "Neu beginnen? Was dieser Auftrag zum Fortsetzen gespeichert hat, wird verworfen; Ergebnisse bleiben.",
  close: "Schließen",
  progress: (done: string, total: string) => `${done} von ${total}`,
  progressDone: (done: string) => `${done} erledigt`,
  resumesAt: (when: string) => `Geht ${when} weiter`,
  state: {
    queued: "Wartet",
    running: "Läuft",
    paused: "Pausiert",
    done: "Fertig",
    partial: "Vorzeitig beendet",
    failed: "Fehlgeschlagen",
    cancelled: "Abgebrochen",
  },
  reasons: {
    rate_limited: "Der Paketdienst hat uns gebeten, langsamer zu machen.",
    captcha: "Der Paketdienst hat ein Captcha gezeigt; sechs Stunden Pause.",
    needs_sign_in: "Die Verbindung braucht eine neue Anmeldung; danach fortsetzen.",
    retrying: "Eine Anfrage ist fehlgeschlagen; gleich neuer Versuch.",
    waiting_for_carrier: "Der Paketdienst antwortet weiter nicht; neuer Versuch in einer Stunde.",
    resting: "Geplante Pause.",
    ceiling: "Lief zwölf Stunden; zum Weitermachen fortsetzen.",
    invalid_config: "Die Einstellungen der Verbindung können nicht funktionieren.",
    page_changed:
      "Der Paketdienst hat eine Seite geändert, die der Provider liest; Provider aktualisieren, dann fortsetzen.",
    action_missing: "Der Provider bietet diese Aktion nicht mehr an.",
    unexpected: "Etwas ist schiefgegangen; fortsetzen versucht es ab der Stelle erneut.",
  },
};
