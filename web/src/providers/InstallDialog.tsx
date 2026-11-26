import { useState, type ReactNode, type SyntheticEvent } from "react";
import { useCheckRepository, useInstallItem } from "../api/installs";
import type { InstallOffer, InstallSource } from "../api/types";
import { Dialog, ErrorNotice, Field } from "../components/ui";
import { t } from "../i18n";
import { CommunityWarning } from "./CommunityWarning";

type OfferedItem = InstallOffer["items"][number];

function OfferedRow(props: {
  readonly offer: InstallOffer;
  readonly item: OfferedItem;
  readonly source: InstallSource;
  readonly onInstalled: (name: string) => void;
}): ReactNode {
  const { offer, item } = props;
  const install = useInstallItem();
  const [understood, setUnderstood] = useState(props.source !== "community");
  const refusal = item.refusal === null ? null : t.providers.dialog.refusal[item.refusal];
  return (
    <li className="card stack">
      <div>
        <strong>{item.name}</strong> <span className="badge">{t.providers.kind[item.kind]}</span>
      </div>
      {item.description === null ? null : <p className="muted">{item.description}</p>}
      <p className="muted">
        {t.providers.dialog.hosts}:{" "}
        {item.hosts.length === 0 ? t.providers.dialog.noHosts : item.hosts.join(", ")}
      </p>
      {refusal === null ? (
        <>
          {props.source === "community" ? (
            <>
              <CommunityWarning
                repository={offer.repository}
                commit={offer.commit}
                name={item.name}
                hosts={item.hosts}
              />
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={understood}
                  onChange={(event) => {
                    setUnderstood(event.target.checked);
                  }}
                />
                {t.providers.dialog.understand}
              </label>
            </>
          ) : null}
          <div className="actions">
            <button
              type="button"
              className="button primary"
              disabled={!understood || install.isPending || install.isSuccess}
              onClick={() => {
                install.mutate(
                  {
                    url: offer.repository,
                    ref: offer.commit,
                    kind: item.kind,
                    id: item.id,
                    source: props.source,
                  },
                  {
                    onSuccess: () => {
                      props.onInstalled(item.name);
                    },
                  },
                );
              }}
            >
              {install.isPending
                ? t.providers.dialog.installing
                : install.isSuccess
                  ? t.providers.installed
                  : t.providers.install}
            </button>
          </div>
        </>
      ) : (
        <p className="notice notice-warning">
          {refusal}
          {item.detail === null ? null : `: ${item.detail}`}
        </p>
      )}
      <ErrorNotice error={install.error} />
    </li>
  );
}

/**
 * Install from a git repository (decision record 0002 §4 C and D): the URL and an optional version
 * are checked first; the result lists what the repository offers, with its hosts, and each item is
 * installed on its own. Opened from the Available tab, the URL (and a verified item's reviewed
 * commit) are filled in.
 */
export function InstallDialog(props: {
  readonly initialUrl?: string;
  readonly initialRef?: string;
  readonly source: InstallSource;
  readonly onClose: () => void;
}): ReactNode {
  const [url, setUrl] = useState(props.initialUrl ?? "");
  const [ref, setRef] = useState(props.initialRef ?? "");
  const [done, setDone] = useState<string | null>(null);
  const check = useCheckRepository();
  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    check.mutate({ url, ...(ref.trim() === "" ? {} : { ref: ref.trim() }) });
  };
  const offer = check.data;
  return (
    <Dialog title={t.providers.dialog.title} open onClose={props.onClose} wide>
      <form className="stack" onSubmit={submit}>
        <Field label={t.providers.dialog.url} hint={t.providers.dialog.urlHint}>
          {(id, describedBy) => (
            <input
              id={id}
              type="url"
              required
              value={url}
              aria-describedby={describedBy}
              onChange={(event) => {
                setUrl(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t.providers.dialog.ref} hint={t.providers.dialog.refHint}>
          {(id, describedBy) => (
            <input
              id={id}
              value={ref}
              aria-describedby={describedBy}
              onChange={(event) => {
                setRef(event.target.value);
              }}
            />
          )}
        </Field>
        {props.source === "url" ? (
          <p className="notice notice-warning">{t.providers.dialog.customNotice}</p>
        ) : null}
        <div className="actions">
          <button type="button" className="button" onClick={props.onClose}>
            {t.providers.dialog.cancel}
          </button>
          <button type="submit" className="button primary" disabled={check.isPending}>
            {check.isPending ? t.providers.dialog.checking : t.providers.dialog.check}
          </button>
        </div>
      </form>
      <ErrorNotice error={check.error} />
      {offer === undefined ? null : (
        <div className="stack">
          <p className="muted">
            {offer.repository} ·{" "}
            {t.providers.dialog.offered(offer.version, offer.commit.slice(0, 7))}
          </p>
          <ul className="plain-list stack">
            {offer.items.map((item) => (
              <OfferedRow
                key={`${item.kind}/${item.id}`}
                offer={offer}
                item={item}
                source={props.source}
                onInstalled={setDone}
              />
            ))}
          </ul>
        </div>
      )}
      {done === null ? null : (
        <p role="status" className="muted">
          {t.providers.dialog.done(done)}
        </p>
      )}
    </Dialog>
  );
}
