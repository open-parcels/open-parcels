import type { Messages } from "../messages";

export const serverSettings: Messages["serverSettings"] = {
  groups: {
    storage: "Speicher",
    server: "Server",
    security: "Sicherheit",
    tracking: "Verfolgung",
    retention: "Aufbewahrung",
    backups: "Sicherungen",
    map: "Karte",
  },
  descriptions: {
    OPENPARCELS_DATA_DIR: "Ordner für Datenbank, Schlüssel und Zwischenspeicher.",
    OPENPARCELS_SECRET_KEY:
      "Base64 von 32 Zufallsbytes, verschlüsselt gespeicherte Zugangsdaten. Ohne Wert wird eine Schlüsseldatei im Datenordner verwendet.",
    OPENPARCELS_WEB_DIR:
      "Ordner mit der gebauten Weboberfläche. Ohne Wert wird web/dist neben dem Server verwendet; fehlt er, gibt es nur die API.",
    OPENPARCELS_HOST: "Adresse, auf der der Server lauscht.",
    OPENPARCELS_PORT: "Port von Weboberfläche und API.",
    OPENPARCELS_INGRESS_PORT:
      "Port des eigenen Listeners für den Home-Assistant-Ingress. Ohne Wert ist er aus.",
    OPENPARCELS_TRUST_PROXY:
      "Reverse-Proxys, deren X-Forwarded-For geglaubt wird, damit die Anmeldebremse echte Client-Adressen sieht: Adressen oder CIDR-Bereiche, durch Kommas getrennt. Ohne Wert wird niemandem vertraut; nie Adressen eintragen, von denen Clients direkt verbinden können.",
    OPENPARCELS_CORS_ORIGINS:
      "Webseiten unter anderen Adressen, die die API aufrufen dürfen, z. B. eine anderswo gehostete Weboberfläche: exakte Origins (https://parcels-ui.example), durch Kommas getrennt. Sie loggen sich mit Tokens ein, nie mit Cookies. Ohne Wert ist keine erlaubt; * wird nie angenommen.",
    OPENPARCELS_SECURE_COOKIES:
      "Sitzungs-Cookies als Secure markieren. Nur einschalten, wenn ausschließlich über HTTPS ausgeliefert wird. Nur über die Umgebung: über reines HTTP eingeschaltet würde es das Login blockieren, das zum Ausschalten nötig ist.",
    OPENPARCELS_ADMIN_PASSWORD:
      "Passwort, um etwas zu ändern: Verbindungen, Pakete, Bestellungen, Einstellungen, Tokens. Ein auf der Einstellungsseite geändertes Passwort ersetzt es bis zum Zurücksetzen. Ohne Wert und dort nie geändert: Der erste Start fragt nach einem Einrichtungscode aus dem Log.",
    OPENPARCELS_PASSWORD:
      "Passwort zum Lesen: Weboberfläche, API, Live-Updates, Karten und Bilder. Leer lässt jeden, der den Server erreicht, alles lesen; Änderungen brauchen immer das Admin-Passwort.",
    OPENPARCELS_PUBLIC_URL: "Öffentliche Basis-URL, für Links in Kalender-Feeds.",
    OPENPARCELS_LOG_LEVEL: "Wie viel der Server protokolliert.",
    OPENPARCELS_TIMEZONE:
      "IANA-Zeitzone (z. B. Europe/Berlin) für die nächtliche Ruhezeit, E-Mail-Daten und Kalendertage. Ohne Wert gilt TZ bzw. die Systemzone.",
    OPENPARCELS_QUIET_WINDOW:
      "Paketdienste zwischen 00:00 und 06:00 Uhr Ortszeit nicht abfragen. Ausschalten, um die ganze Nacht abzufragen.",
    OPENPARCELS_EMAIL_ROUTING:
      "E-Mails von den eigenen Absenderdomains eines Providers an diesen Provider geben, sobald der empfangende Mailserver den Absender bestätigt hat (DKIM oder DMARC). Aus: Die gemeinsamen E-Mail-Regeln lesen jede E-Mail.",
    OPENPARCELS_PROVIDER_ISOLATION:
      "Wo die eingebauten Provider laufen: off lässt sie im Prozess des Servers laufen; pool lässt sie gemeinsam in einem eigenen Prozess unter dem Berechtigungsmodell von Node laufen, der Netzwerk, Anmeldedaten und Sitzungen nur über den Server erreicht, einen Aufruf nach dem anderen. Pool kostet einen weiteren Prozess (etwa 60 MB).",
    OPENPARCELS_PROVIDERS_REMOTE:
      "Registry lesen, GitHub nach Community-Einträgen durchsuchen und Provider, Themes und Consumer aus Git-Repositorys installieren oder aktualisieren. Aus: nichts wird abgerufen, für Installationen ohne Internet; die eingebauten funktionieren weiter.",
    OPENPARCELS_PROVIDERS_COMMUNITY:
      "Community-Einträge auf der Provider-Seite zeigen: GitHub-Repositorys mit dem Topic open-parcels-provider, die niemand bei open-parcels geprüft hat. Sie sind markiert, und vor dem Installieren wird nachgefragt.",
    OPENPARCELS_REGISTRY_URL:
      "Woher der signierte Registry-Index (index.json und index.json.sig) gelesen wird; ein Spiegel geht auch, denn nur die Signatur zählt.",
    OPENPARCELS_ARCHIVE_DAYS:
      "Tage nach der Zustellung, bis ein Paket archiviert wird und seine Rohdaten vom Paketdienst verworfen werden.",
    OPENPARCELS_DELETE_DAYS:
      "Tage nach dem Archivieren, bis ein Paket mit Verlauf und Rohdaten gelöscht wird; 0 nie (Standard). Von Hand löschen geht immer auf der Datenseite.",
    OPENPARCELS_NOT_FOUND_ARCHIVE_DAYS:
      "Tage, die ein Paketdienst für ein nicht zugestelltes Paket „nicht gefunden“ melden darf, bevor es archiviert wird; 0 nie.",
    OPENPARCELS_BACKUP_HOURS:
      "Stunden zwischen automatischen Datenbanksicherungen, solange der Server läuft; 0 schaltet sie aus. „Jetzt sichern“ auf der Einstellungsseite geht so oder so.",
    OPENPARCELS_BACKUP_KEEP:
      "Wie viele Datenbanksicherungen behalten werden; die ältesten werden nach jeder neuen gelöscht. Zählt jede Sicherung im Ordner, auch die von Hand oder vor dem Löschen aller Daten.",
    OPENPARCELS_BACKUP_DIR:
      "Ordner für Datenbanksicherungen. Ohne Wert backups/ im Datenordner; auf ein anderes Laufwerk zeigen lassen, um Sicherungen nicht auf der Platte der Datenbank zu haben. Der Schlüssel ist nicht Teil einer Sicherung: auch eine Kopie davon aufheben (secret.key im Datenordner oder OPENPARCELS_SECRET_KEY).",
    OPENPARCELS_MAP_BASE_LAYER:
      "Kartenstil, bis jemand auf der Karte einen anderen wählt: Karte, topografisch, Satellit, nur Grenzen, ein CARTO-Stil (braucht den CARTO-Schlüssel) oder der eigene Anbieter.",
    OPENPARCELS_MAP_OVERLAY:
      "Ebene, die standardmäßig über dem Kartenstil liegt; Beschriftungen passen zu Satellitenbildern.",
    OPENPARCELS_GEOCODING:
      "Ortssuche im Hintergrund: die in Ereignissen genannten Orte mit dem Ortssuchdienst unten nachschlagen (OpenStreetMap Nominatim, wenn nicht geändert), damit auch Ereignisse ohne Koordinaten auf der Karte erscheinen. Dabei gehen diese Ortsnamen (nie deine Nummern oder Adressen) an den Dienst, höchstens einer pro Sekunde. Standardmäßig aus; die Adresssuche auf der Einstellungsseite geht so oder so.",
    OPENPARCELS_GEOCODING_URL:
      "Such-Endpunkt eines Nominatim-kompatiblen Ortssuchdienstes (/search?q=…&format=jsonv2), z. B. eines eigenen Nominatim. Für die Adresssuche und die Ortssuche im Hintergrund. Der öffentliche OpenStreetMap-Server erlaubt höchstens eine Anfrage pro Sekunde und keine starke Nutzung.",
    OPENPARCELS_CONTACT_EMAIL:
      "Optionale Kontaktadresse im User-Agent an Ortssuche und Kachelserver, damit deren Betreiber dich erreichen können, statt diese Installation zu sperren.",
    OPENPARCELS_MAP_CARTO_KEY:
      "CARTO-API-Schlüssel (für nicht kommerzielle Nutzung kostenlos unter carto.com/basemaps/apikey). Schaltet die CARTO-Stile frei: Dark Matter (das Aussehen vor dem Neubau), Positron und Voyager. Bleibt auf dem Server.",
    OPENPARCELS_MAP_OSM_URL:
      "Kacheladresse der einfachen Kartenebene, Standard https://tile.openstreetmap.org/{z}/{x}/{y}.png. Auf einen Spiegel oder eigenen Kachelserver zeigen lassen, wenn der öffentliche nicht passt.",
    OPENPARCELS_MAP_TOPO_URL:
      "Kacheladresse der topografischen Ebene, Standard https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png.",
    OPENPARCELS_MAP_EOX_URL:
      "WMTS-Basisadresse der EOX-Ebenen (Satellit, Grenzen, Beschriftungen), Standard https://tiles.maps.eox.at/wmts/1.0.0.",
    OPENPARCELS_MAP_CUSTOM_URL:
      "Eigener Kachelanbieter, z. B. https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key={key}. Braucht https und {z}, {x}, {y}; {s}, {r} und {key} füllt der Server aus.",
    OPENPARCELS_MAP_CUSTOM_KEY:
      "API-Schlüssel für {key} des eigenen Anbieters. Bleibt auf dem Server.",
    OPENPARCELS_MAP_CUSTOM_ATTRIBUTION:
      "Quellenangabe auf der Karte für den eigenen Anbieter, wie seine Bedingungen es verlangen.",
    OPENPARCELS_MAP_CUSTOM_MAX_ZOOM:
      "Größte Zoomstufe, die der eigene Anbieter liefert; darüber vergrößert die Karte.",
  },
};
