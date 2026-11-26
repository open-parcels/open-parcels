import { useState, type ReactNode } from "react";
import {
  useAvailableConsumers,
  useConsumers,
  useDeleteConsumer,
  useTestConsumer,
} from "../api/queries";
import type { ConsumerSetup } from "../api/types";
import { useIsAdmin } from "../auth/session";
import { ErrorNotice, ReadOnlyHint, Spinner } from "../components/ui";
import { t } from "../i18n";
import { ConsumerDialog } from "./ConsumerDialog";
import { lastDelivery } from "./delivery";

type Editing =
  { readonly mode: "add" } | { readonly mode: "edit"; readonly consumer: ConsumerSetup };

function TestButton({ id }: { readonly id: string }): ReactNode {
  const test = useTestConsumer();
  const outcome = test.data;
  const text =
    outcome === undefined
      ? null
      : outcome.ok
        ? t.consumers.testOk
        : outcome.retry
          ? t.consumers.testRetry(outcome.message ?? "")
          : t.consumers.testFailed(outcome.message ?? "");
  return (
    <>
      <button
        type="button"
        className="button"
        disabled={test.isPending}
        onClick={() => {
          test.mutate(id);
        }}
      >
        {test.isPending ? t.consumers.testing : t.consumers.test}
      </button>
      <span role="status" className="muted">
        {text}
      </span>
      <ErrorNotice error={test.error} />
    </>
  );
}

function ConsumerCard(props: {
  readonly consumer: ConsumerSetup;
  readonly name: string;
  readonly admin: boolean;
  readonly onEdit: () => void;
}): ReactNode {
  const { consumer } = props;
  const remove = useDeleteConsumer();
  return (
    <li className="card stack">
      <div>
        <h2>{consumer.label}</h2>
        <span className="muted">{props.name}</span>{" "}
        {consumer.enabled ? null : <span className="badge">{t.consumers.off}</span>}
      </div>
      <p className="muted">{lastDelivery(consumer)}</p>
      {props.admin ? (
        <div className="actions">
          <TestButton id={consumer.id} />
          <button type="button" className="button" onClick={props.onEdit}>
            {t.consumers.edit}
          </button>
          <button
            type="button"
            className="button"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(t.consumers.removeQuestion(consumer.label))) {
                remove.mutate(consumer.id);
              }
            }}
          >
            {t.consumers.remove}
          </button>
        </div>
      ) : null}
      <ErrorNotice error={remove.error} />
    </li>
  );
}

/** Consumers: where notifications go, with their rules and last delivery (`docs/consumers.md`). */
export function ConsumersPage(): ReactNode {
  const admin = useIsAdmin();
  const consumers = useConsumers();
  const available = useAvailableConsumers();
  const [editing, setEditing] = useState<Editing | null>(null);
  const nameOf = (id: string): string =>
    available.data?.find((consumer) => consumer.id === id)?.name ?? id;

  return (
    <section aria-labelledby="consumers-title">
      <div className="page-header">
        <h1 id="consumers-title">{t.consumers.title}</h1>
        {admin ? (
          <button
            type="button"
            className="button primary"
            onClick={() => {
              setEditing({ mode: "add" });
            }}
          >
            {t.consumers.add}
          </button>
        ) : null}
      </div>
      <p className="muted">{t.consumers.intro}</p>
      {admin ? null : <ReadOnlyHint />}
      <ErrorNotice error={consumers.error} />
      {consumers.data === undefined ? (
        consumers.isPending ? (
          <Spinner />
        ) : null
      ) : consumers.data.length === 0 ? (
        <p className="muted">{t.consumers.empty}</p>
      ) : (
        <ul className="plain-list stack">
          {consumers.data.map((consumer) => (
            <ConsumerCard
              key={consumer.id}
              consumer={consumer}
              name={nameOf(consumer.consumer)}
              admin={admin}
              onEdit={() => {
                setEditing({ mode: "edit", consumer });
              }}
            />
          ))}
        </ul>
      )}
      {editing === null ? null : (
        <ConsumerDialog
          key={editing.mode === "edit" ? editing.consumer.id : "add"}
          editing={editing.mode === "edit" ? editing.consumer : null}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}
