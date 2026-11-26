import { GENERIC_RETURN_RULE, type EmailParseResult, type Rules } from "open-parcels-rules";
import { shopFromDomain } from "../domain/order.js";
import { returnSnapshot, type PaymentRef, type ReturnSnapshot } from "../provider/snapshot.js";
import { carrierFor, orderOf, emailResults, senderDomain, senderName } from "./interpret.js";
import type { MailInput, MailReturnInterpreter } from "./types.js";

function tracking(
  rules: Rules,
  result: EmailParseResult,
  domain: string | undefined,
): { carrier: string; trackingNumber: string } | null {
  for (const trackingNumber of result.trackingNumbers) {
    const carrier = carrierFor(rules, result, trackingNumber, domain);
    if (carrier !== null) return { carrier, trackingNumber };
  }
  return null;
}

/**
 * The order a return email is about: the one its rule names; for a shop no rule knows
 * (`generic-return`), the sender domain's; for a payment service's refund without a reference,
 * the one paid that much to that payee before the email.
 */
function orderOfResult(
  result: EmailParseResult,
  mail: MailInput,
  domain: string | undefined,
): ReturnSnapshot["order"] | null {
  const orderNumber = result.orderNumbers[0];
  if (result.ruleId === GENERIC_RETURN_RULE) {
    const shop = shopFromDomain(domain);
    return shop === null || orderNumber === undefined ? null : { shop, orderNumber };
  }
  const order = orderOf(result.ruleId, orderNumber, domain, senderName(mail.from));
  if (order !== null) return { shop: order.shop, orderNumber: order.orderNumber };
  if (orderNumber !== undefined || result.total === undefined) return null;
  const payment: PaymentRef = {
    payee: result.shop ?? null,
    total: result.total,
    paidBefore: mail.date?.toISOString() ?? null,
  };
  return payment;
}

/**
 * Turns return and refund emails (the rules' `return` kind) into return reports; what the
 * email says about the return is the rules' reading (`result.return`). An email whose order
 * cannot be named is skipped.
 */
export function createReturnInterpreter(rules: Rules, timeZone: string): MailReturnInterpreter {
  return (mail: MailInput): readonly ReturnSnapshot[] => {
    const domain = senderDomain(mail.from);
    const reports: ReturnSnapshot[] = [];
    for (const result of emailResults(rules, mail, timeZone)) {
      if (result.kind !== "return") continue;
      const order = orderOfResult(result, mail, domain);
      if (order === null) continue;
      const details = result.return;
      const refunded = result.event === "refund_issued";
      const money = details?.refund;
      reports.push(
        returnSnapshot({
          order,
          externalRef: details?.returnId ?? null,
          status: details?.status ?? null,
          reason: details?.reason ?? null,
          returnBy: details?.returnBy ?? null,
          dropOff: (details?.dropOff ?? []).map((option) => ({
            carrier: option.carrier ?? null,
            kind: option.kind,
            description: option.description,
          })),
          cost:
            details?.cost === undefined
              ? null
              : {
                  free: details.cost.free,
                  amount: details.cost.amount ?? null,
                  currency: details.cost.currency ?? null,
                },
          labelUrl: details?.labelUrl ?? null,
          tracking: tracking(rules, result, domain),
          refund:
            money === undefined && !refunded
              ? null
              : {
                  amount: money?.amount ?? null,
                  currency: money?.currency ?? null,
                  status: refunded ? "issued" : "pending",
                },
          items: result.items ?? [],
          // A refund alone may be for a cancelled order; a payment matched by amount never
          // starts a return.
          mayCreate: "orderNumber" in order && (!refunded || details?.aboutReturn === true),
        }),
      );
    }
    return reports;
  };
}
