import { loadRules, withEmailRules } from "open-parcels-rules";
import { describe, expect, it } from "vitest";
import {
  carrierFor,
  createMailInterpreter,
  senderDomain,
  senderName,
  subjectAsStatus,
} from "../../src/mail/interpret.js";
import { DHL_EMAIL_RULES } from "../../src/carriers/dhl/email-rules.js";
import { TO_FALLBACK_SERVICE } from "../../src/mail/types.js";

const rules = loadRules();
/** DHL emails are read with the DHL provider's email rules, as the inbox routes them. */
const interpret = createMailInterpreter(withEmailRules(rules, DHL_EMAIL_RULES), "Europe/Berlin");

describe("mail interpretation with email rules", () => {
  it("turns a German DHL shipping notice into a DHL parcel", () => {
    const snapshots = interpret({
      messageId: null,
      authentication: null,
      from: "DHL Paket <noreply@dhl.de>",
      subject: "Ihr DHL Paket kommt heute",
      text: "Guten Tag, Ihre Sendung 00340434000000000017 wird heute zugestellt.",
      html: null,
      date: new Date("2026-11-18T07:00:00Z"),
    });
    expect(snapshots.map((s) => [s.carrier, s.trackingNumber])).toEqual([
      ["dhl", "00340434000000000017"],
    ]);
  });

  it("files a shop's number of a carrier no rule knows for the fallback service", () => {
    const snapshots = createMailInterpreter(
      rules,
      "Europe/Berlin",
    )({
      messageId: null,
      authentication: null,
      from: "versandinfo@reichelt.de",
      subject: "Ihre Bestellung wurde versandt",
      text: "I-Net Nummer 123456\nIhre Sendungsnummer lautet QX7KW2PL9M\n",
      html: null,
      date: new Date("2026-11-18T07:00:00Z"),
    });
    expect(snapshots.map((s) => [s.carrier, s.trackingNumber, s.order?.orderNumber])).toEqual([
      [TO_FALLBACK_SERVICE, "QX7KW2PL9M", "123456"],
    ]);
  });

  it("ignores mails without a tracking number", () => {
    expect(
      interpret({
        messageId: null,
        authentication: null,
        from: "news@shop.example.invalid",
        subject: "Sale!",
        text: "Everything 20% off.",
        html: null,
        date: null,
      }),
    ).toEqual([]);
  });
});

describe("mail interpretation details (OP-142)", () => {
  const dhlMail = {
    messageId: null,
    authentication: null,
    from: "DHL Paket <noreply@dhl.de>",
    subject: "Ihr DHL Paket kommt heute",
    html: null,
    date: new Date("2026-11-18T07:00:00Z"),
  };

  it("gives one parcel per tracking number in a mail", () => {
    const snapshots = interpret({
      ...dhlMail,
      text: [
        "Guten Tag, Ihre Sendung 00340434000000000017 wird heute zugestellt.",
        "Ihre Sendung 00340434000000000024 wird heute zugestellt.",
      ].join("\n"),
    });
    expect(snapshots.map((s) => s.trackingNumber).sort()).toEqual([
      "00340434000000000017",
      "00340434000000000024",
    ]);
  });

  it("gives the same mail the same history id, by Message-ID or by its content", () => {
    const text = "Guten Tag, Ihre Sendung 00340434000000000017 wird heute zugestellt.";
    const idOf = (mail: Parameters<typeof interpret>[0]) => interpret(mail)[0]?.history[0]?.id;
    expect(idOf({ ...dhlMail, text })).toBe(
      idOf({ ...dhlMail, text, date: new Date("2026-11-19T08:00:00Z") }),
    );
    expect(idOf({ ...dhlMail, text, messageId: "<a@example.invalid>" })).toBe(
      "mail:<a@example.invalid>",
    );
  });

  it("files a number no rule names a carrier for under the best match, never under upu", () => {
    const result = {
      kind: "parcel",
      ruleId: "test",
      trackingNumbers: [],
      orderNumbers: [],
    } as const;
    expect(carrierFor(rules, { ...result, carrier: "gls" }, "anything", undefined)).toBe("gls");
    expect(carrierFor(rules, result, "00340434000000000017", "dhl.de")).toBe("dhl");
    expect(carrierFor(rules, result, "RR123456785CN", undefined)).not.toBe("upu");
  });

  it("reads the sender's domain and display name", () => {
    expect(senderDomain("Example Store <Shop@Example.COM>")).toBe("example.com");
    expect(senderDomain("shop@example.com")).toBe("example.com");
    expect(senderName('"Example Store" <shop@example.com>')).toBe("Example Store");
    expect(senderName("shop@example.com")).toBeNull();
  });
});

describe("mail subjects as status text (OP-131)", () => {
  it("mask addresses, codes and digit runs, and drop a subject that came with a pickup code", () => {
    expect(
      subjectAsStatus(
        "Abholcode 482913 für someone@example.invalid, Sendung 00340434000000000017",
        false,
      ),
    ).toBe("Abholcode … für [email], Sendung 0034…");
    expect(subjectAsStatus("Your parcel is on its way", false)).toBe("Your parcel is on its way");
    expect(subjectAsStatus("Code 482913 opens locker 12", true)).toBeNull();
  });
});
