import { loadRules } from "open-parcels-rules";
import { describe, expect, it } from "vitest";
import { ampereSnapshot } from "../../src/carriers/ampere/page.js";
import { normalizeDe } from "../../src/carriers/dhl/de/normalize.js";
import { finishSignIn } from "../../src/carriers/dhl/de/session.js";
import { slovakTime } from "../../src/carriers/slovak_parcel_service/parse.js";
import { verificationToken } from "../../src/carriers/vinted_go/account.js";
import { isPlausibleOrder } from "../../src/domain/order.js";
import { mergeParcel } from "../../src/engine/merge.js";
import { fileUnderTracked } from "../../src/engine/tracked.js";
import { createMailInterpreter } from "../../src/mail/interpret.js";
import {
  asTracked,
  isoTime,
  localDay,
  own,
  SignInRejectedError,
  unescapeHtml,
  zonedIso,
  type ProviderHttp,
  type ProviderLogger,
} from "../../src/provider/api.js";
import { snapshot } from "../../src/provider/snapshot.js";

/*
 * Acceptance tests for the audit's "rewrite" items (OP-088 … OP-139), as the provider kit and the
 * engine behave now. `docs/audit-rewrite-items.md` maps each item to its test and status. Every
 * value here is made up.
 */

const CODE = "TEST0000000001";

describe("OP-089: an estimate given only as its latest time", () => {
  it("replaces the stored window like one given with both ends", () => {
    const at = (expectedTo: string) =>
      snapshot({
        carrier: "ontrac",
        trackingNumber: CODE,
        status: "in_transit",
        rawStatus: "In transit",
        expectedTo,
        history: [
          { at: "2026-11-17T08:00:00.000Z", status: "in_transit", rawStatus: "x", location: null },
        ],
      });
    const first = mergeParcel(null, at("2026-11-18T20:00:00.000Z"), "carrier");
    const moved = mergeParcel(first, at("2026-11-19T20:00:00.000Z"), "carrier");
    expect(moved).toMatchObject({ expectedFrom: null, expectedTo: "2026-11-19T20:00:00.000Z" });
  });
});

describe("OP-090: a zone name the runtime does not know", () => {
  it("gives null instead of throwing, in the kit and for isoTime", () => {
    expect(zonedIso({ year: 2026, month: 11, day: 18, hour: 10 }, "Mars/Base")).toBeNull();
    expect(isoTime("2026-11-18T10:00:00", { naive: { zone: "Mars/Base" } })).toBeNull();
    expect(zonedIso({ year: 2026, month: 11, day: 18, hour: 10 }, "Europe/Berlin")).toBe(
      "2026-11-18T09:00:00.000Z",
    );
  });
});

describe("OP-091: a day-first date that ends in -YYYY", () => {
  it("is not taken for a value with an offset", () => {
    const options = { naive: { zone: "Europe/Paris" } } as const;
    expect(isoTime("05-11-2026", options)).toBeNull();
    expect(isoTime("2026-11-18T10:00-0500", options)).toBe("2026-11-18T15:00:00.000Z");
    expect(isoTime("2026-11-18 10:00:00+01:00", options)).toBe("2026-11-18T09:00:00.000Z");
    expect(isoTime("2026-11-18T10:00:00Z", options)).toBe("2026-11-18T10:00:00.000Z");
  });
});

describe("OP-092: the providers' own 'has an offset' checks", () => {
  it("accept an offset after a time and nothing that merely contains a z", () => {
    expect(slovakTime("2026-11-18T10:00:00+01:00")).toBe("2026-11-18T09:00:00.000Z");
    expect(slovakTime("18-11-2026")).toBeNull();
    expect(slovakTime("Zásielka doručená")).toBeNull();
  });
});

describe("OP-094: the end of a local delivery day", () => {
  it("is 23:59:59 local time also on the day the clocks go back", () => {
    // 25 October 2026 has 25 hours in Paris.
    expect(localDay("2026-10-24T22:00:00.000Z", "Europe/Paris")).toEqual({
      from: "2026-10-24T22:00:00.000Z",
      to: "2026-10-25T22:59:59.000Z",
    });
  });
});

describe("OP-095: Ampère history rows", () => {
  it("keep each status with its own time when one row has none", () => {
    const row = (status: string, time: string) =>
      `<li><span data-test-id="history-entry-status">${status}</span>` +
      `<span data-test-id="history-entry-time">${time}</span></li>`;
    const found = ampereSnapshot(
      {
        html: `<ul>${row("C", "Wo 18 nov 12:00")}${row("B", "")}${row("A", "Di 17 nov 09:30")}</ul>`,
        parcelToken: "p0",
        window: {},
        now: new Date("2026-11-19T00:00:00Z"),
      },
      () => undefined,
    );
    expect(found.history.map((event) => [event.rawStatus, event.at])).toEqual([
      ["C", "2026-11-18T11:00:00.000Z"],
      ["A", "2026-11-17T08:30:00.000Z"],
    ]);
  });
});

describe("OP-096: a DHL Germany return", () => {
  it("is returning and not delivered, even when DHL flags it as delivered", () => {
    const found = normalizeDe(
      { reportUnknown: () => undefined },
      {
        id: "00340000000000000003",
        sendungsinfo: { sendungsrichtung: "ANKOMMEND" },
        sendungsdetails: {
          istZugestellt: true,
          retoure: true,
          sendungsverlauf: { datumAktuellerStatus: "2026-11-17T08:00:00", events: [] },
        },
      },
    );
    expect(found).toMatchObject({ status: "returning", delivered: false, deliveredAt: null });
  });
});

describe("OP-100: the carrier's echo as external reference", () => {
  const found = (trackingNumber: string) =>
    snapshot({ carrier: "test", trackingNumber, status: null, rawStatus: null });

  it("is kept only when it is a number of its own", () => {
    expect(asTracked(found(""), CODE).externalRef).toBeNull();
    expect(asTracked(found("test 0000-000001"), CODE).externalRef).toBeNull();
    expect(asTracked(found("CARRIER-OWN-1"), CODE)).toMatchObject({
      trackingNumber: CODE,
      externalRef: "CARRIER-OWN-1",
    });
  });

  it("is kept the same way by the host's safety net", () => {
    const logger: ProviderLogger = {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
    };
    const result = fileUnderTracked(
      "test",
      [CODE],
      { snapshots: [found("")], complete: false },
      logger,
    );
    expect(result.snapshots[0]).toMatchObject({ trackingNumber: CODE, externalRef: null });
  });
});

describe("OP-103: pasted sign-in input", () => {
  it("that is not an address or carries a stray % is a refused sign-in", async () => {
    expect(() => verificationToken("https://example.invalid/verify?token=%E0")).toThrow(
      SignInRejectedError,
    );
    expect(verificationToken("https://example.invalid/verify?token=abc%3D")).toBe("abc=");
    // Refused before any request: the HTTP client is never reached.
    const http = null as unknown as ProviderHttp;
    await expect(
      finishSignIn(http, { verifier: "v", state: "s" }, "not an address"),
    ).rejects.toBeInstanceOf(SignInRejectedError);
  });
});

describe("OP-104 and OP-134: lookups with carrier, user or old-database text", () => {
  it("never reach inherited names", () => {
    expect(unescapeHtml("&constructor; &amp; &AMP;")).toBe("&constructor; & &");
    expect(own({ kg: 1 }, "constructor")).toBeUndefined();
    expect(own({ kg: 1 }, "kg")).toBe(1);
    expect(isPlausibleOrder("constructor", "123")).toBe(true);
  });
});

describe("OP-126: an email without a usable date", () => {
  it("gives a parcel without an event instead of one stamped with the wall clock", () => {
    const interpret = createMailInterpreter(loadRules(), "Europe/Berlin");
    const found = interpret({
      messageId: null,
      authentication: null,
      from: "DHL Paket <noreply@dhl.de>",
      subject: "Ihr DHL Paket kommt heute",
      text: "Guten Tag, Ihre Sendung 00340434000000000017 wird heute zugestellt.",
      html: null,
      date: null,
    });
    expect(found.map((parcel) => [parcel.trackingNumber, parcel.history])).toEqual([
      ["00340434000000000017", []],
    ]);
  });
});
