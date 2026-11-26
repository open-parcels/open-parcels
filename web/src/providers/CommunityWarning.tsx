import { Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { t } from "../i18n";

/**
 * The warning on a community item (owner decisions 3 and 6, 2026-11-23): a yellow notice with a
 * link to the source and a copy button for a ready-made review prompt for an AI agent.
 */
export function CommunityWarning(props: {
  readonly repository: string;
  readonly commit: string;
  readonly name: string;
  readonly hosts: readonly string[];
}): ReactNode {
  const [copied, setCopied] = useState(false);
  const prompt = t.providers.community.prompt({
    repository: props.repository,
    commit: props.commit,
    name: props.name,
    hosts: props.hosts.length === 0 ? "-" : props.hosts.join(", "),
  });
  return (
    <div className="notice community-warning" role="note">
      <p>
        <span aria-hidden="true">⚠ </span>
        {t.providers.community.warning}{" "}
        <button
          type="button"
          className="icon-button"
          aria-label={t.providers.community.copyPrompt}
          title={t.providers.community.copyPrompt}
          onClick={() => {
            void navigator.clipboard.writeText(prompt).then(() => {
              setCopied(true);
            });
          }}
        >
          <Copy size={16} aria-hidden="true" />
        </button>
        {copied ? (
          <span role="status" className="muted">
            {" "}
            {t.providers.community.copied}
          </span>
        ) : null}
      </p>
      <a
        href={`${props.repository}/tree/${props.commit}`}
        target="_blank"
        rel="noreferrer noopener"
      >
        {t.providers.community.viewSource}
      </a>
    </div>
  );
}
