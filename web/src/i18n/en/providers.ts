/** English texts: the Providers page (installed and available, install from URL, consent). */
export const providers = {
  title: "Providers",
  intro:
    "Providers bring parcels and orders in, consumers send notifications out and themes change how open-parcels looks. Built-in ones come with open-parcels; others install from a git repository.",
  tabs: { installed: "Installed", available: "Available" },
  tabsLegend: "Show",
  installFromUrl: "Install from URL",
  refresh: "Refresh",
  search: "Search",
  empty: "Nothing here.",
  kind: { provider: "Provider", theme: "Theme", consumer: "Consumer" },
  tier: {
    builtin: "Built in",
    verified: "Verified",
    custom: "Custom",
    community: "Community · unreviewed",
  },
  tierHint: {
    builtin: "Comes with open-parcels and updates with it.",
    verified: "The open-parcels maintainers reviewed exactly this version.",
    custom: "Added by you from a git repository. Not reviewed by open-parcels.",
    community:
      "Found on GitHub by the topic open-parcels-provider. Nobody at open-parcels has reviewed it.",
  },
  version: (version: string) => `Version ${version}`,
  autoUpdate: "Update automatically",
  autoUpdateFixed: "Updates with open-parcels",
  uninstall: "Uninstall",
  uninstallQuestion: (name: string) => `Uninstall ${name}?`,
  install: "Install",
  installed: "Installed",
  details: "Check",
  source: { verified: "Verified", community: "Community" },
  sourceLegend: "Where from",
  stars: (count: number) => `★ ${String(count)}`,
  similarTo: (id: string) => `Looks similar to "${id}"`,
  registryChecked: (when: string) => `Registry read ${when}.`,
  registryStale: (days: number) =>
    `The registry's signed list is ${String(days)} days past its expiry; it is still used.`,
  registryError: (error: string) => `The registry could not be read: ${error}`,
  remoteOff: "Installing is switched off on this server (OPENPARCELS_PROVIDERS_REMOTE).",
  communityOff: "Community discovery is switched off on this server.",
  communityChecked: (when: string) => `Results from GitHub, searched ${when}.`,
  communityError: (error: string) => `GitHub could not be searched: ${error}`,
  verifiedEmpty: "The registry lists no verified providers yet.",
  dialog: {
    title: "Install from a git repository",
    url: "Repository URL",
    urlHint: "https://host/owner/repository on GitHub, GitLab or a Gitea server",
    ref: "Version",
    refHint: "A release tag (v1.2.3) or a full commit. Empty: the newest release.",
    check: "Check repository",
    checking: "Checking…",
    customNotice:
      "Custom items are not reviewed by open-parcels. Install only from people you trust.",
    offered: (version: string, commit: string) => `${version} · commit ${commit}`,
    hosts: "May reach",
    noHosts: "No network access",
    refusal: {
      needs_bundles:
        "This server cannot run installed code yet; only themes can be installed for now.",
      invalid: "Not valid",
      reserved: "A built-in item has this id.",
      blocked: "Blocked by the registry",
    },
    understand: "I understand this code is unreviewed.",
    cancel: "Cancel",
    installing: "Installing…",
    done: (name: string) => `${name} is installed.`,
  },
  community: {
    warning:
      "This is an unreviewed community add-on. Nobody at open-parcels has checked its code. Read its source code before you install it, or give it to your agent to check:",
    viewSource: "View source",
    copyPrompt: "Copy review prompt",
    copied: "Copied",
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
