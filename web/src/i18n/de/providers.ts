import type { Messages } from "../messages";

/** Deutsche Texte: die Provider-Seite. "Provider" und "Consumer" bleiben unübersetzt. */
export const providers: Messages["providers"] = {
  title: "Provider",
  intro:
    "Provider holen Sendungen und Bestellungen herein, Consumer senden Benachrichtigungen hinaus, Themes ändern das Aussehen von open-parcels. Eingebaute kommen mit open-parcels, weitere lassen sich aus einem Git-Repository installieren.",
  tabs: { installed: "Installiert", available: "Verfügbar" },
  tabsLegend: "Anzeigen",
  installFromUrl: "Von URL installieren",
  refresh: "Aktualisieren",
  search: "Suchen",
  empty: "Hier ist nichts.",
  kind: { provider: "Provider", theme: "Theme", consumer: "Consumer" },
  tier: {
    builtin: "Eingebaut",
    verified: "Geprüft",
    custom: "Eigene",
    community: "Community · ungeprüft",
  },
  tierHint: {
    builtin: "Kommt mit open-parcels und wird mit ihm aktualisiert.",
    verified: "Die Maintainer von open-parcels haben genau diese Version geprüft.",
    custom: "Von dir aus einem Git-Repository hinzugefügt. Nicht von open-parcels geprüft.",
    community:
      "Auf GitHub über das Topic open-parcels-provider gefunden. Niemand bei open-parcels hat es geprüft.",
  },
  version: (version: string) => `Version ${version}`,
  autoUpdate: "Automatisch aktualisieren",
  autoUpdateFixed: "Wird mit open-parcels aktualisiert",
  uninstall: "Deinstallieren",
  uninstallQuestion: (name: string) => `${name} deinstallieren?`,
  install: "Installieren",
  installed: "Installiert",
  details: "Prüfen",
  source: { verified: "Geprüft", community: "Community" },
  sourceLegend: "Herkunft",
  stars: (count: number) => `★ ${String(count)}`,
  similarTo: (id: string) => `Ähnelt „${id}“`,
  registryChecked: (when: string) => `Registry gelesen ${when}.`,
  registryStale: (days: number) =>
    `Die signierte Liste der Registry ist seit ${String(days)} Tagen abgelaufen; sie wird weiter verwendet.`,
  registryError: (error: string) => `Die Registry war nicht lesbar: ${error}`,
  remoteOff: "Installieren ist auf diesem Server ausgeschaltet (OPENPARCELS_PROVIDERS_REMOTE).",
  communityOff: "Die Community-Suche ist auf diesem Server ausgeschaltet.",
  communityChecked: (when: string) => `Ergebnisse von GitHub, gesucht ${when}.`,
  communityError: (error: string) => `GitHub war nicht durchsuchbar: ${error}`,
  verifiedEmpty: "Die Registry führt noch keine geprüften Provider.",
  dialog: {
    title: "Aus einem Git-Repository installieren",
    url: "Repository-URL",
    urlHint: "https://host/besitzer/repository auf GitHub, GitLab oder einem Gitea-Server",
    ref: "Version",
    refHint: "Ein Release-Tag (v1.2.3) oder ein vollständiger Commit. Leer: das neueste Release.",
    check: "Repository prüfen",
    checking: "Wird geprüft …",
    customNotice:
      "Eigene Einträge prüft open-parcels nicht. Installiere nur von Leuten, denen du vertraust.",
    offered: (version: string, commit: string) => `${version} · Commit ${commit}`,
    hosts: "Darf erreichen",
    noHosts: "Kein Netzwerkzugriff",
    refusal: {
      needs_bundles:
        "Dieser Server kann installierten Code noch nicht ausführen; vorerst lassen sich nur Themes installieren.",
      invalid: "Nicht gültig",
      reserved: "Ein eingebauter Eintrag hat diese ID.",
      blocked: "Von der Registry gesperrt",
    },
    understand: "Mir ist klar, dass dieser Code ungeprüft ist.",
    cancel: "Abbrechen",
    installing: "Wird installiert …",
    done: (name: string) => `${name} ist installiert.`,
  },
  community: {
    warning:
      "Dies ist eine ungeprüfte Community-Erweiterung. Niemand bei open-parcels hat ihren Code geprüft. Lies den Quellcode, bevor du sie installierst, oder gib ihn deinem Agenten zur Prüfung:",
    viewSource: "Quellcode ansehen",
    copyPrompt: "Prüf-Prompt kopieren",
    copied: "Kopiert",
    prompt: (values: {
      repository: string;
      commit: string;
      name: string;
      hosts: string;
    }) => `This is a community provider (integration) for open-parcels, a self-hosted parcel tracking
server: ${values.repository} at commit ${values.commit}.
It asks for: network access to ${values.hosts}.
Please audit its code for security before I install it:
1. Does it send data anywhere other than the declared hosts, or more data than it needs?
2. Could it misuse or leak my login, session or mail contents?
3. Is any code obfuscated, minified without source, dynamically loaded or evaluated?
4. Does it do anything beyond tracking parcels/orders for ${values.name}?
Answer with a verdict (looks safe / suspicious / do not install) and the reasons, citing files
and lines.`,
  },
};
