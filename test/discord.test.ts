import assert from "node:assert/strict";
import test from "node:test";

import {
  sendErrorNotification,
  sendRecoveryNotification,
  sendSeatAlert,
  sendTestNotification,
} from "../src/discord.ts";
import { TARGETS } from "../src/config.ts";
import { eligibleAvailablePairs } from "../src/seats.ts";
import type { SeatAlertEvent, SeatMap } from "../src/types.ts";

const webhook = "https://discord.com/api/webhooks/123/token";

function event(): SeatAlertEvent {
  const map: SeatMap = {
    theaterName: "Regal Irvine Spectrum",
    auditoriumId: "12",
    seats: [
      { id: "E2", row: 5, column: 20, status: "A", type: "standard", x: 100, y: 50, width: 24, height: 24 },
      { id: "E1", row: 5, column: 21, status: "A", type: "standard", x: 130, y: 50, width: 24, height: 24 },
    ],
  };
  return {
    target: TARGETS[1]!,
    showtime: {
      hash: "hash",
      startsAtLocal: "2026-09-02T14:30",
      startsAtEpochMs: Date.parse("2026-09-02T21:30:00Z"),
      displayTime: "2:30p",
    },
    map,
    pairs: eligibleAvailablePairs(map),
    returnedSeatIds: ["E2"],
  };
}

test("sends a multipart seat alert with an attached PNG", async () => {
  let payload: Record<string, unknown> | undefined;
  let image: Blob | undefined;
  await sendSeatAlert(webhook, event(), async (_input, init) => {
    const form = init?.body as FormData;
    payload = JSON.parse(String(form.get("payload_json"))) as Record<string, unknown>;
    const file = form.get("files[0]");
    if (file instanceof Blob) image = file;
    return new Response(null, { status: 204 });
  });
  assert.ok(Array.isArray(payload?.embeds));
  assert.equal(image?.type, "image/png");
  assert.ok((image?.size ?? 0) > 1_000_000);
});

test("sends error, recovery, and test messages as JSON", async () => {
  const titles: string[] = [];
  const fetchImpl = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as { embeds: Array<{ title: string }> };
    titles.push(body.embeds[0]!.title);
    return new Response(null, { status: 204 });
  };
  await sendErrorNotification(webhook, [{ stage: "catalog", message: "blocked" }], fetchImpl);
  await sendRecoveryNotification(webhook, fetchImpl);
  await sendTestNotification(webhook, fetchImpl);
  assert.deepEqual(titles, [
    "Fandango notifier error",
    "Fandango notifier recovered",
    "Fandango notifier is ready",
  ]);
});

test("rejects non-Discord webhook URLs and failed deliveries", async () => {
  await assert.rejects(
    () => sendTestNotification("https://example.com/hook", async () => new Response(null, { status: 204 })),
    /must be an HTTPS Discord webhook URL/,
  );
  await assert.rejects(
    () => sendTestNotification(webhook, async () => new Response("rate limited", { status: 429 })),
    /HTTP 429: rate limited/,
  );
});
