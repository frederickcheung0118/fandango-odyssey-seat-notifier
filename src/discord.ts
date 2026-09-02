import { renderSeatMapPng } from "./png.ts";
import type { RunError, SeatAlertEvent } from "./types.ts";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const defaultFetch: FetchLike = (input, init) => fetch(input, init);

function validateWebhook(url: string): void {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !["discord.com", "discordapp.com"].includes(parsed.hostname) ||
    !parsed.pathname.startsWith("/api/webhooks/")
  ) {
    throw new Error("DISCORD_WEBHOOK_URL must be an HTTPS Discord webhook URL");
  }
}

async function requireDiscordSuccess(response: Response): Promise<void> {
  if (response.ok) return;
  const body = (await response.text()).slice(0, 300);
  throw new Error(`Discord webhook returned HTTP ${response.status}${body ? `: ${body}` : ""}`);
}

export async function sendSeatAlert(
  webhookUrl: string,
  event: SeatAlertEvent,
  fetchImpl: FetchLike = defaultFetch,
): Promise<void> {
  validateWebhook(webhookUrl);
  const highlighted = new Set(event.pairs.flatMap((pair) => pair.seats.map((seat) => seat.id)));
  const png = renderSeatMapPng(event.map, highlighted, event.returnedSeatIds);
  const pairLines = event.pairs
    .slice(0, 12)
    .map((pair) => `**${pair.seats[0].id} + ${pair.seats[1].id}** — score ${pair.score}`)
    .join("\n");
  const epochSeconds = Math.floor(event.showtime.startsAtEpochMs / 1_000);
  const payload = {
    username: "Fandango Seat Notifier",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: `Returned seats — ${event.target.name}`,
        url: absoluteTicketUrl(event.showtime.ticketingUrl, event.target.pageUrl),
        color: 0xfacc15,
        description: `**The Odyssey — IMAX 70MM**\n<t:${epochSeconds}:F> (<t:${epochSeconds}:R>)`,
        fields: [
          { name: "Eligible adjacent pairs", value: pairLines || "None", inline: false },
          {
            name: "Filter",
            value: "2 adjacent standard seats • rows E–I or K • score >50",
            inline: false,
          },
        ],
        image: { url: "attachment://seat-map.png" },
        footer: { text: "Read-only availability check — no seats are held or purchased" },
        timestamp: new Date().toISOString(),
      },
    ],
  };
  const bytes = new Uint8Array(png.length);
  bytes.set(png);
  const form = new FormData();
  form.set("payload_json", JSON.stringify(payload));
  form.set("files[0]", new Blob([bytes.buffer], { type: "image/png" }), "seat-map.png");
  await requireDiscordSuccess(await fetchImpl(webhookUrl, { method: "POST", body: form }));
}

export async function sendErrorNotification(
  webhookUrl: string,
  errors: RunError[],
  fetchImpl: FetchLike = defaultFetch,
): Promise<void> {
  const lines = errors
    .slice(0, 12)
    .map(
      (error) =>
        `• ${error.target ? `**${error.target}** ` : ""}${error.stage}${error.showtime ? ` (${error.showtime})` : ""}: ${error.message}`,
    )
    .join("\n")
    .slice(0, 3_800);
  await sendJsonWebhook(
    webhookUrl,
    {
      username: "Fandango Seat Notifier",
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: "Fandango notifier error",
          color: 0xef4444,
          description: lines,
          footer: { text: "Repeated identical errors are suppressed for six hours" },
          timestamp: new Date().toISOString(),
        },
      ],
    },
    fetchImpl,
  );
}

export async function sendRecoveryNotification(webhookUrl: string, fetchImpl: FetchLike = defaultFetch): Promise<void> {
  await sendJsonWebhook(
    webhookUrl,
    {
      username: "Fandango Seat Notifier",
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: "Fandango notifier recovered",
          color: 0x22c55e,
          description: "Both theater checks completed without errors again.",
          timestamp: new Date().toISOString(),
        },
      ],
    },
    fetchImpl,
  );
}

export async function sendTestNotification(webhookUrl: string, fetchImpl: FetchLike = defaultFetch): Promise<void> {
  await sendJsonWebhook(
    webhookUrl,
    {
      username: "Fandango Seat Notifier",
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: "Fandango notifier is ready",
          color: 0x3b82f6,
          description: "Deployment, Discord delivery, and the five-minute schedule are configured.",
          timestamp: new Date().toISOString(),
        },
      ],
    },
    fetchImpl,
  );
}

async function sendJsonWebhook(
  webhookUrl: string,
  payload: object,
  fetchImpl: FetchLike,
): Promise<void> {
  validateWebhook(webhookUrl);
  await requireDiscordSuccess(
    await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

function absoluteTicketUrl(ticketingUrl: string | undefined, fallback: string): string {
  if (!ticketingUrl) return fallback;
  try {
    return new URL(ticketingUrl, "https://www.fandango.com").toString();
  } catch {
    return fallback;
  }
}
