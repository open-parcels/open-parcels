import type { JobState } from "../../api/types";

/** English texts: connection actions and their jobs. The German file has the same keys. */
export const jobs = {
  actions: "Actions",
  start: (label: string) => `${label}…`,
  confirmDestructive: (label: string) => `Type “${label}” to confirm.`,
  inputTitle: (label: string) => label,
  startButton: "Start",
  cancel: "Cancel",
  resume: "Resume",
  restart: "Start over",
  restartQuestion: "Start over? What this job saved to continue from is dropped; results stay.",
  close: "Close",
  progress: (done: string, total: string) => `${done} of ${total}`,
  progressDone: (done: string) => `${done} done`,
  resumesAt: (when: string) => `Continues ${when}`,
  state: {
    queued: "Waiting",
    running: "Running",
    paused: "Paused",
    done: "Done",
    partial: "Stopped early",
    failed: "Failed",
    cancelled: "Cancelled",
  } satisfies Record<JobState, string>,
  /** Why a job is paused or failed (`reason`); an unknown one shows no text. */
  reasons: {
    rate_limited: "The carrier asked us to slow down.",
    captcha: "The carrier showed a captcha; paused for six hours.",
    needs_sign_in: "The connection needs a new sign-in; resume afterwards.",
    retrying: "A request failed; trying again shortly.",
    waiting_for_carrier: "The carrier keeps failing; trying again in an hour.",
    resting: "Taking a planned break.",
    ceiling: "Ran for twelve hours; resume to continue.",
    invalid_config: "The connection's settings cannot work.",
    page_changed:
      "The carrier changed a page the provider reads; update the providers, then resume.",
    action_missing: "The provider no longer offers this action.",
    unexpected: "Something went wrong; resume to try again from where it stopped.",
  } as Readonly<Record<string, string | undefined>>,
};
