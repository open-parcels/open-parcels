import { useMemo, useState, type ReactNode, type SyntheticEvent } from "react";
import {
  useAddConsumer,
  useAvailableConsumers,
  useConnections,
  useUpdateConsumer,
} from "../api/queries";
import type { AvailableConsumer, ConsumerSetup, NotificationRules } from "../api/types";
import { LogoTile } from "../components/CarrierLogo";
import { Dialog, ErrorNotice, Field } from "../components/ui";
import type { PickerEntry } from "../connections/picker";
import { ProviderPicker } from "../connections/ProviderPicker";
import { SchemaFields } from "../connections/SchemaForm";
import {
  asSchema,
  cleanValues,
  initialValues,
  type FormValues,
  type JsonSchema,
} from "../connections/schema";
import { LANGUAGE, t } from "../i18n";
import { RulesEditor } from "./RulesEditor";

/** What a new consumer starts with: the parcel milestones, at once, in the page's language. */
const DEFAULT_RULES: NotificationRules = {
  events: [
    "registered",
    "out_for_delivery",
    "at_pickup_point",
    "delivered",
    "problem",
    "refunded",
    "sign_in_needed",
    "backup_failed",
  ],
  directions: ["receiving", "sending"],
  connections: null,
  quiet_hours: null,
  digest: "immediately",
  language: LANGUAGE,
};

const PICKER_LABELS = {
  search: t.consumers.pickerSearch,
  main: t.consumers.pickerHeading,
  other: t.consumers.pickerHeading,
};

function pickerEntries(available: readonly AvailableConsumer[]): PickerEntry[] {
  return available
    .map((consumer) => ({
      id: consumer.id,
      name: consumer.name,
      countries: [],
      aliases: [consumer.description],
      logo: null,
      other: false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, LANGUAGE));
}

/** The secret form with every field optional: empty keeps the stored secret when editing. */
function secretForm(consumer: AvailableConsumer | undefined): JsonSchema | null {
  if (consumer?.secret_schema === null || consumer === undefined) return null;
  return { ...asSchema(consumer.secret_schema), required: [] };
}

/** Empty: no secret (adding) or keep it (editing). */
function secretValue(schema: JsonSchema | null, values: FormValues): FormValues | undefined {
  if (schema === null) return undefined;
  const cleaned = cleanValues(schema, values);
  return Object.keys(cleaned).length === 0 ? undefined : cleaned;
}

/**
 * Adds a consumer (pick one first, like "Add a connection", then its settings, secret and rules)
 * or edits an existing one.
 */
export function ConsumerDialog(props: {
  readonly editing: ConsumerSetup | null;
  readonly onClose: () => void;
}): ReactNode {
  const available = useAvailableConsumers();
  const connections = useConnections();
  const add = useAddConsumer();
  const update = useUpdateConsumer();
  const list = useMemo(() => available.data ?? [], [available.data]);
  const entries = useMemo(() => pickerEntries(list), [list]);
  const { editing } = props;
  const [chosenId, setChosenId] = useState(editing?.consumer ?? "");
  const chosen = list.find((consumer) => consumer.id === chosenId);
  const config = asSchema(chosen?.config_schema);
  const secret = secretForm(chosen);
  const [label, setLabel] = useState(editing?.label ?? "");
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);
  const [values, setValues] = useState<FormValues>(() => initialValues(config, editing?.config));
  const [secretValues, setSecretValues] = useState<FormValues>({});
  const [rules, setRules] = useState<NotificationRules>(editing?.rules ?? DEFAULT_RULES);
  const mutation = editing === null ? add : update;

  const choose = (id: string): void => {
    const next = list.find((consumer) => consumer.id === id);
    setChosenId(id);
    setValues(initialValues(asSchema(next?.config_schema), undefined));
    setSecretValues({});
    if (next !== undefined) setLabel(next.name);
  };

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    const body = {
      label,
      enabled,
      rules,
      config: cleanValues(config, values),
    };
    const newSecret = secretValue(secret, secretValues);
    if (editing !== null) {
      update.mutate(
        { id: editing.id, body: newSecret === undefined ? body : { ...body, secret: newSecret } },
        { onSuccess: props.onClose },
      );
      return;
    }
    add.mutate(
      { ...body, consumer: chosenId, secret: newSecret ?? null },
      { onSuccess: props.onClose },
    );
  };

  return (
    <Dialog
      title={editing === null ? t.consumers.add : t.consumers.editTitle(editing.label)}
      open
      onClose={props.onClose}
      wide
    >
      {chosenId === "" ? (
        <ProviderPicker entries={entries} onChoose={choose} labels={PICKER_LABELS} />
      ) : (
        <form onSubmit={submit} className="stack">
          {chosen === undefined ? null : (
            <div className="picker-chosen">
              <LogoTile carrier={chosen.id} name={chosen.name} logo={null} size={36} />
              <span className="picker-name">{chosen.name}</span>
              <span className="muted">{chosen.description}</span>
            </div>
          )}
          <Field label={t.consumers.name}>
            {(id) => (
              <input
                id={id}
                required
                maxLength={80}
                value={label}
                onChange={(event) => {
                  setLabel(event.target.value);
                }}
              />
            )}
          </Field>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => {
                setEnabled(event.target.checked);
              }}
            />
            {t.consumers.enabled}
          </label>
          <h3>{t.consumers.settings}</h3>
          <SchemaFields schema={config} values={values} onChange={setValues} />
          {secret === null ? null : (
            <>
              <h3>{t.consumers.secretTitle}</h3>
              {editing?.has_secret === true ? (
                <p className="muted">
                  {t.consumers.secretStored} {t.consumers.secretKeep}
                </p>
              ) : null}
              <SchemaFields schema={secret} values={secretValues} onChange={setSecretValues} />
            </>
          )}
          <RulesEditor rules={rules} connections={connections.data ?? []} onChange={setRules} />
          <ErrorNotice error={mutation.error} />
          <div className="actions">
            <button type="button" className="button" onClick={props.onClose}>
              {t.consumers.cancel}
            </button>
            <button type="submit" className="button primary" disabled={mutation.isPending}>
              {editing === null ? t.consumers.addButton : t.consumers.save}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
