import type { ReactNode } from "react";
import type { Connection, Digest, NotificationEvent, NotificationRules } from "../api/types";
import { Field } from "../components/ui";
import { listingEvery } from "../lib/exhaustive";
import { t } from "../i18n";

/** Every notification event, in the order the editor lists them. */
const EVENTS = listingEvery<NotificationEvent>()([
  "registered",
  "in_transit",
  "out_for_delivery",
  "at_pickup_point",
  "delivered",
  "delivery_time_changed",
  "returning",
  "problem",
  "refunded",
  "sign_in_needed",
  "backup_failed",
]);

const DIGESTS = listingEvery<Digest>()(["immediately", "hourly", "daily"]);
const LANGUAGES = ["en", "de"] as const;
type Direction = NotificationRules["directions"][number];

/** `list` with `value` added or taken out. */
function toggled<T>(list: readonly T[], value: T, on: boolean): T[] {
  return on ? [...list.filter((entry) => entry !== value), value] : list.filter((e) => e !== value);
}

function Check(props: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}): ReactNode {
  return (
    <label className="checkbox">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => {
          props.onChange(event.target.checked);
        }}
      />
      {props.label}
    </label>
  );
}

function ConnectionChoice(props: {
  readonly rules: NotificationRules;
  readonly connections: readonly Connection[];
  readonly onChange: (rules: NotificationRules) => void;
}): ReactNode {
  const { rules } = props;
  const chosen = rules.connections;
  return (
    <fieldset className="stack">
      <legend>{t.consumers.connections}</legend>
      <Check
        label={t.consumers.allConnections}
        checked={chosen === null}
        onChange={(all) => {
          props.onChange({ ...rules, connections: all ? null : [] });
        }}
      />
      {chosen === null
        ? null
        : props.connections.map((connection) => (
            <Check
              key={connection.id}
              label={connection.label}
              checked={chosen.includes(connection.id)}
              onChange={(on) => {
                props.onChange({ ...rules, connections: toggled(chosen, connection.id, on) });
              }}
            />
          ))}
    </fieldset>
  );
}

function QuietHours(props: {
  readonly rules: NotificationRules;
  readonly onChange: (rules: NotificationRules) => void;
}): ReactNode {
  const { rules } = props;
  const quiet = rules.quiet_hours;
  const time = (label: string, value: string, set: (value: string) => void): ReactNode => (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          type="time"
          required
          value={value}
          onChange={(event) => {
            set(event.target.value);
          }}
        />
      )}
    </Field>
  );
  return (
    <fieldset className="stack">
      <legend>{t.consumers.quietHours}</legend>
      <Check
        label={t.consumers.quietHours}
        checked={quiet !== null}
        onChange={(on) => {
          props.onChange({ ...rules, quiet_hours: on ? { from: "22:00", to: "07:00" } : null });
        }}
      />
      {quiet === null ? null : (
        <div className="stack">
          {time(t.consumers.quietFrom, quiet.from, (from) => {
            props.onChange({ ...rules, quiet_hours: { ...quiet, from } });
          })}
          {time(t.consumers.quietTo, quiet.to, (to) => {
            props.onChange({ ...rules, quiet_hours: { ...quiet, to } });
          })}
        </div>
      )}
      <small className="hint">{t.consumers.quietHint}</small>
    </fieldset>
  );
}

/** The notification rules of one consumer: events, directions, connections, timing, language. */
export function RulesEditor(props: {
  readonly rules: NotificationRules;
  readonly connections: readonly Connection[];
  readonly onChange: (rules: NotificationRules) => void;
}): ReactNode {
  const { rules, onChange } = props;
  const direction = (value: Direction, label: string): ReactNode => (
    <Check
      label={label}
      checked={rules.directions.includes(value)}
      onChange={(on) => {
        const next = toggled(rules.directions, value, on);
        // One direction at least: the last one cannot be switched off.
        if (next.length > 0) onChange({ ...rules, directions: next });
      }}
    />
  );
  return (
    <div className="stack">
      <h3>{t.consumers.rules}</h3>
      <fieldset className="inline">
        <legend>{t.consumers.events}</legend>
        {EVENTS.map((event) => (
          <Check
            key={event}
            label={t.consumers.event[event]}
            checked={rules.events.includes(event)}
            onChange={(on) => {
              onChange({ ...rules, events: toggled(rules.events, event, on) });
            }}
          />
        ))}
      </fieldset>
      <fieldset className="inline">
        <legend>{t.consumers.directions}</legend>
        {direction("receiving", t.consumers.receiving)}
        {direction("sending", t.consumers.sending)}
      </fieldset>
      <ConnectionChoice rules={rules} connections={props.connections} onChange={onChange} />
      <QuietHours rules={rules} onChange={onChange} />
      <Field label={t.consumers.digest}>
        {(id) => (
          <select
            id={id}
            value={rules.digest}
            onChange={(event) => {
              onChange({ ...rules, digest: event.target.value as Digest });
            }}
          >
            {DIGESTS.map((digest) => (
              <option key={digest} value={digest}>
                {t.consumers.digests[digest]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t.consumers.language}>
        {(id) => (
          <select
            id={id}
            value={rules.language}
            onChange={(event) => {
              onChange({ ...rules, language: event.target.value as NotificationRules["language"] });
            }}
          >
            {LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {t.consumers.languages[language]}
              </option>
            ))}
          </select>
        )}
      </Field>
    </div>
  );
}
