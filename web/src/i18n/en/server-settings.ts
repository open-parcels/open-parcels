import type {
  GetApiV1SettingsConfig200ItemGroup as SettingGroup,
  GetApiV1SettingsConfig200ItemKey as SettingKey,
} from "../../api/generated";

/** Names of the server's setting groups and a description per setting, by key. */
export const serverSettings: {
  readonly groups: Readonly<Record<SettingGroup, string>>;
  readonly descriptions: Readonly<Record<SettingKey, string>>;
} = {
  groups: {
    storage: "Storage",
    server: "Server",
    security: "Security",
    tracking: "Tracking",
    retention: "Retention",
    backups: "Backups",
    map: "Map",
  },
  descriptions: {
    OPENPARCELS_DATA_DIR: "Folder for the database, encryption key and caches.",
    OPENPARCELS_SECRET_KEY:
      "Base64 of 32 random bytes that encrypts stored credentials. Unset uses a key file in the data folder.",
    OPENPARCELS_WEB_DIR:
      "Folder with the built web UI. Unset uses web/dist next to the server; missing means API only.",
    OPENPARCELS_HOST: "Address the server listens on.",
    OPENPARCELS_PORT: "Port of the web UI and API.",
    OPENPARCELS_INGRESS_PORT:
      "Port of the separate Home Assistant ingress listener. Unset disables it.",
    OPENPARCELS_TRUST_PROXY:
      "Reverse proxies whose X-Forwarded-For is believed, so the sign-in throttle sees real client addresses: comma-separated addresses or CIDR ranges. Unset trusts nobody; never list addresses clients could connect from directly.",
    OPENPARCELS_CORS_ORIGINS:
      "Web pages on other addresses that may call the API, e.g. a web UI hosted elsewhere: exact origins (https://parcels-ui.example), separated by commas. They log in with tokens, never cookies. Unset allows none; * is never accepted.",
    OPENPARCELS_SECURE_COOKIES:
      "Mark session cookies Secure. Turn on when served over HTTPS only. Environment only: turned on over plain HTTP it would block the sign-in needed to turn it off again.",
    OPENPARCELS_ADMIN_PASSWORD:
      "Password to change anything: connections, parcels, orders, settings, tokens. A password changed on the Settings page replaces it until reset. Unset and never changed there: the first start asks for a setup code from the log.",
    OPENPARCELS_PASSWORD:
      "Password to read: the web UI, the API, live updates, maps and images. Empty lets anyone who can reach the server read everything; changes always need the admin password.",
    OPENPARCELS_PUBLIC_URL: "Public base URL, used for links in calendar feeds.",
    OPENPARCELS_LOG_LEVEL: "How much the server logs.",
    OPENPARCELS_TIMEZONE:
      "IANA time zone (e.g. Europe/Berlin) for the night-time quiet window, email dates and calendar days. Unset uses TZ / the system zone.",
    OPENPARCELS_QUIET_WINDOW:
      "Pause carrier polling 00:00–06:00 local time. Turn off to poll all night.",
    OPENPARCELS_EMAIL_ROUTING:
      "Hand emails from a provider's own sender domains to that provider, once the receiving mail server confirmed the sender (DKIM or DMARC). Off: the shared email rules read every email.",
    OPENPARCELS_PROVIDER_ISOLATION:
      "Where the built-in providers run: off runs them in the server's own process; pool runs them together in one separate process under Node's permission model, which reaches the network, the sign-in data and the sessions only through the server, one call at a time. Pool costs one more process (about 60 MB).",
    OPENPARCELS_PROVIDERS_REMOTE:
      "Read the registry, search GitHub for community items and install or update providers, themes and consumers from git repositories. Off: nothing is fetched, for air-gapped installs; the built-in ones keep working.",
    OPENPARCELS_PROVIDERS_COMMUNITY:
      "List community items on the Providers page: GitHub repositories with the topic open-parcels-provider, which nobody at open-parcels has reviewed. They are marked and installing one asks first.",
    OPENPARCELS_REGISTRY_URL:
      "Where the signed registry index (index.json and index.json.sig) is read from; a mirror works, since only the signature counts.",
    OPENPARCELS_ARCHIVE_DAYS:
      "Days after delivery before a parcel is archived and its raw carrier data dropped.",
    OPENPARCELS_DELETE_DAYS:
      "Days after archiving before a parcel, its history and raw carrier data are deleted; 0 never (the default). Deleting by hand is always possible on the Data page.",
    OPENPARCELS_NOT_FOUND_ARCHIVE_DAYS:
      "Days a carrier may answer “not found” for an undelivered parcel before it is archived; 0 never.",
    OPENPARCELS_BACKUP_HOURS:
      "Hours between automatic database backups, taken while the server runs; 0 turns them off. Back up now on the Settings page works either way.",
    OPENPARCELS_BACKUP_KEEP:
      "How many database backups to keep; the oldest are deleted after each new one. Counts every backup in the folder, also those taken by hand or before deleting everything.",
    OPENPARCELS_BACKUP_DIR:
      "Folder for database backups. Unset uses backups/ in the data folder; point it at another volume to keep backups off the disk the database is on. The encryption key is not part of a backup: keep a copy of it (secret.key in the data folder, or OPENPARCELS_SECRET_KEY) as well.",
    OPENPARCELS_MAP_BASE_LAYER:
      "Map style shown until a user picks another on the map: map, topographic, satellite, borders only, a CARTO style (needs the CARTO key), or the custom provider.",
    OPENPARCELS_MAP_OVERLAY:
      "Overlay drawn over the map style by default; labels suit satellite imagery.",
    OPENPARCELS_GEOCODING:
      "Background place lookup: look up the places named in carrier scans with the place search service below (OpenStreetMap Nominatim unless changed), so events without coordinates still show on the map. This sends those place names (never codes or addresses of yours) to that service, one a second at most. Off by default; the address search on the Settings page works either way.",
    OPENPARCELS_GEOCODING_URL:
      "Search endpoint of a Nominatim-compatible place search service (/search?q=…&format=jsonv2), e.g. your own Nominatim. Used by the address search and the background place lookup. The public OpenStreetMap server allows at most one request a second and no heavy use.",
    OPENPARCELS_CONTACT_EMAIL:
      "Optional contact address added to the User-Agent sent to the place search and tile servers, so their operators can reach you instead of blocking this install.",
    OPENPARCELS_MAP_CARTO_KEY:
      "CARTO API key (free for non-commercial use at carto.com/basemaps/apikey). Unlocks the CARTO styles: Dark Matter (the pre-rewrite look), Positron and Voyager. Stays on the server.",
    OPENPARCELS_MAP_OSM_URL:
      "Tile address of the plain map layer, default https://tile.openstreetmap.org/{z}/{x}/{y}.png. Point it at a mirror or your own tile server if the public one is unsuitable.",
    OPENPARCELS_MAP_TOPO_URL:
      "Tile address of the topographic layer, default https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png.",
    OPENPARCELS_MAP_EOX_URL:
      "WMTS base address of the EOX layers (satellite, borders, labels), default https://tiles.maps.eox.at/wmts/1.0.0.",
    OPENPARCELS_MAP_CUSTOM_URL:
      "Custom tile provider, e.g. https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key={key}. Needs https and {z}, {x}, {y}; {s}, {r} and {key} are filled in by the server.",
    OPENPARCELS_MAP_CUSTOM_KEY: "API key for the custom provider's {key}. Stays on the server.",
    OPENPARCELS_MAP_CUSTOM_ATTRIBUTION:
      "Credit shown on the map for the custom provider, as its terms require.",
    OPENPARCELS_MAP_CUSTOM_MAX_ZOOM:
      "Deepest zoom the custom provider serves; the map scales up beyond it.",
  },
};
