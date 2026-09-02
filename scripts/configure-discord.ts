import { sendTestNotification } from "../src/discord.ts";

const webhookUrl = process.env.NOTIFIER_DISCORD_WEBHOOK;
if (!webhookUrl) throw new Error("Discord webhook was not provided");

await sendTestNotification(webhookUrl);
console.log("Discord test notification sent successfully.");
