import { admin } from "./admin";
import {
  backupErrorText,
  param,
  pick,
  withDetail,
  type ErrorText,
  type ErrorTexts,
  type InvalidConnectionReason,
  type NotFoundResource,
  type PasswordProblem,
  type SettingProblem,
} from "../params";

const NOT_FOUND: Readonly<Record<NotFoundResource, ErrorText>> = {
  route: () => "Diese Adresse gibt es nicht.",
  connection: () => "Die Verbindung wurde nicht gefunden.",
  order: () => "Die Bestellung wurde nicht gefunden.",
  parcel: () => "Das Paket wurde nicht gefunden.",
  return: () => "Die Rücksendung wurde nicht gefunden.",
  token: () => "Das Token wurde nicht gefunden.",
  login: () => "Der Login wurde nicht gefunden.",
  calendar_feed: () => "Diesen Kalender-Feed gibt es nicht.",
  sign_in: () => "Die Anmeldung wurde nicht gefunden. Bitte neu beginnen.",
  setting: () => "Diese Einstellung gibt es nicht.",
  pictures: () => "Es gibt keine Artikelbilder.",
  job: () => "Der Auftrag wurde nicht gefunden.",
  consumer: () => "Der Consumer wurde nicht gefunden.",
};

const INVALID_CONNECTION: Readonly<Record<InvalidConnectionReason, ErrorText>> = {
  inbox_kind: () => "Postfächer werden mit dem Postfach-Formular hinzugefügt.",
  inbox_fields: () => "Das Postfach braucht einen Server, einen Benutzernamen und ein Passwort.",
  unknown_provider: (p) => `Es gibt keinen Provider namens ${param(p, "provider")}.`,
  no_such_kind: (p) => `${param(p, "provider")} kann so nicht verwendet werden.`,
  secret_mismatch: (p) => `Die Anmeldedaten passen nicht zu ${param(p, "provider")}.`,
  invalid_fields: (p) => `Bitte diese Felder prüfen: ${param(p, "fields")}.`,
  no_such_sign_in: (p) => `${param(p, "provider")} hat keine solche Anmeldung.`,
  no_tracking_provider: (p) => `Es gibt keinen Provider, der ${param(p, "provider")} verfolgt.`,
  provider: (p) =>
    withDetail("Mit diesen Einstellungen kann die Verbindung nicht funktionieren.", p),
};

const INVALID_SETTING: Readonly<Record<SettingProblem, ErrorText>> = {
  unknown: (p) => `${param(p, "key")}: Diese Einstellung gibt es nicht.`,
  own_form: (p) => `${param(p, "key")}: Bitte über das eigene Formular ändern.`,
  env_only: (p) => `${param(p, "key")}: Kann nur in der Umgebung gesetzt werden.`,
  required: (p) =>
    `${param(p, "key")}: Ein Wert ist nötig. Setze die Einstellung zurück, um wieder die Umgebung oder den Standard zu verwenden.`,
  too_short: (p) => `${param(p, "key")}: Mindestens ${param(p, "min")} Zeichen verwenden.`,
  wrong_type: (p) => `${param(p, "key")}: Text, eine Zahl oder Ja/Nein eingeben.`,
  invalid: (p) => withDetail(`${param(p, "key")}: Dieser Wert ist ungültig.`, p),
};

const INVALID_PASSWORD: Readonly<Record<PasswordProblem, ErrorText>> = {
  wrong_current: () => "Das aktuelle Admin-Passwort ist falsch.",
  too_short: (p) => `Mindestens ${param(p, "min")} Zeichen verwenden.`,
};

/** German texts for the server's error codes. */
export const errors: ErrorTexts = {
  byCode: {
    unauthorized: () => "Bitte erneut einloggen.",
    forbidden: (p) => `Dafür ist die Berechtigung „${param(p, "scope")}“ nötig.`,
    csrf: () => "Die Seite ist veraltet. Bitte neu laden und erneut versuchen.",
    admin_required: () => "Nur der Admin darf etwas ändern. Mit dem Admin-Passwort einloggen.",
    not_found: pick(NOT_FOUND, "resource", "Nicht gefunden."),
    invalid_request: (p) => withDetail("Die Anfrage ist ungültig.", p),
    internal: () => "Auf dem Server ist etwas schiefgelaufen.",
    invalid_range: () =>
      "Der Zeitraum muss nach seinem Beginn enden und darf höchstens 400 Tage umfassen.",
    carrier_not_detected: () =>
      "Der Paketdienst ließ sich an dieser Sendungsnummer nicht erkennen. Wähle einen aus oder füge einen Ausweichdienst hinzu (Universal lookup, 17TRACK).",
    duplicate: () => "Dieses Paket wird bereits verfolgt.",
    backup_failed: (p) =>
      `Die Sicherung ist fehlgeschlagen: ${backupErrorText(admin.backupErrors, p)}`,
    delete_backup_failed: (p) =>
      `Nichts wurde gelöscht: Die Sicherung vor dem Löschen ist fehlgeschlagen. ${backupErrorText(admin.backupErrors, p)}`,
    confirmation_required: (p) =>
      `Gib ${param(p, "phrase")} ein, um das Löschen aller Pakete und Bestellungen zu bestätigen.`,
    invalid_setting: pick(INVALID_SETTING, "reason", "Dieser Wert ist ungültig."),
    geocode_failed: (p) => withDetail("Die Ortssuche ist fehlgeschlagen.", p),
    tile: () => "Die Kartenkachel konnte nicht geladen werden.",
    image: () => "Das Bild konnte nicht geladen werden.",
    too_many_attempts: (p) =>
      `Zu viele Fehlversuche. Versuche es in ${param(p, "seconds")} Sekunden erneut.`,
    current_required: () => "Gib das aktuelle Admin-Passwort ein.",
    invalid_password: pick(
      INVALID_PASSWORD,
      "reason",
      "Dieses Passwort kann nicht verwendet werden.",
    ),
    no_environment_password: () =>
      "In der Umgebung ist kein OPENPARCELS_ADMIN_PASSWORD gesetzt, auf das zurückgegriffen werden kann; ändere stattdessen das Passwort.",
    already_set_up: () => "Das Admin-Passwort ist bereits gesetzt.",
    bad_setup_code: () => "Der Einrichtungscode stimmt nicht mit dem im Container-Log überein.",
    wrong_password: () => "Das Passwort ist nicht richtig.",
    login_ended: () => "Der Login ist abgelaufen. Bitte erneut einloggen.",
    sync_expired: () => "Diese Kopie ist zu alt zum Aktualisieren. Bitte alles neu laden.",
    invalid_connection: pick(
      INVALID_CONNECTION,
      "reason",
      "Mit diesen Einstellungen kann die Verbindung nicht funktionieren.",
    ),
    connection_backing_off: (p) =>
      `Der Paketdienst hat um eine Pause gebeten; diese Verbindung läuft wieder in ${param(p, "seconds")} Sekunden.`,
    sign_in_expired: () => "Diese Anmeldung ist abgelaufen. Bitte neu beginnen.",
    sign_in_timeout: () => "Die Bestätigung kam nicht rechtzeitig. Bitte neu beginnen.",
    sign_in_refused: () => "Der Paketdienst hat das abgelehnt. Bitte prüfen und erneut versuchen.",
    sign_in_failed: () => "Das hat nicht geklappt. Bitte Eingaben prüfen und erneut versuchen.",
    sign_in_wrong_step: () =>
      "Dieser Schritt ist schon erledigt. Mit dem aktuellen Schritt weitermachen.",
    sign_in_poll_too_soon: () => "Bitte einen Moment warten, bevor erneut geprüft wird.",
    sign_in_unavailable: () =>
      "Der Paketdienst war nicht erreichbar. Deine Anmeldung bleibt erhalten; versuche denselben Schritt noch einmal.",
    sign_in_captcha: () =>
      "Der Paketdienst hat ein Captcha gezeigt. Deine Anmeldung bleibt erhalten; warte eine Weile und versuche denselben Schritt dann noch einmal.",
    no_sign_in: () => "Diese Verbindung hat keine solche Anmeldung.",
    no_such_action: () => "Diese Verbindung hat keine solche Aktion.",
    action_unavailable: () =>
      "Diese Aktion kann gerade nicht starten (prüfe den Zustand der Verbindung).",
    action_cooldown: (p) =>
      `Diese Aktion lief vor Kurzem; versuche es in ${param(p, "seconds")} Sekunden erneut.`,
    invalid_input: (p) => withDetail("Prüfe deine Eingaben.", p),
    job_running: () => "Diese Verbindung hat schon einen laufenden Auftrag.",
    job_state: () => "Das geht im aktuellen Zustand des Auftrags nicht.",
    invalid_consumer: (p) => withDetail("Prüfe die Einstellungen und Regeln des Consumers.", p),
    install_refused: (p) => withDetail("Das lässt sich nicht installieren.", p),
  },
  http: (status) => `Der Server hat mit Fehler ${String(status)} geantwortet.`,
};
