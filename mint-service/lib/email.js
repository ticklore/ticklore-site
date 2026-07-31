/**
 * lib/email.js — deliver the ticket by email after it mints.
 *
 * DESIGN RULE: email must never break the mint.
 *
 * By the time this runs, the ticket already exists permanently on-chain. Email
 * is delivery, not payment. If Resend is down, rate-limited, or misconfigured,
 * the buyer still owns their ticket — we log the failure and move on. Nothing
 * in here is allowed to throw in a way that unwinds a successful mint.
 *
 * The Resend SDK returns { data, error } instead of throwing, so we check
 * `error` explicitly rather than wrapping in try/catch and hoping.
 */

let resendClient = null;

function getClient() {
  if (resendClient) return resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;               // email simply off; not an error
  const { Resend } = require("resend");
  resendClient = new Resend(key);
  return resendClient;
}

/**
 * Send the "your ticket is ready" email.
 *
 * @returns {Promise<{sent: boolean, id?: string, reason?: string}>}
 *          Always resolves. Never rejects. The caller can log the result but
 *          should not treat a false as a failure of the purchase.
 */
async function sendTicketEmail({ to, eventName, ticketId, viewUrl, custodial }) {
  if (!to) return { sent: false, reason: "no recipient email on the order" };

  const client = getClient();
  if (!client) return { sent: false, reason: "RESEND_API_KEY not set — email disabled" };

  // Until a real domain is verified in Resend, this must be an @resend.dev
  // address. FROM_EMAIL lets us switch to tickets@ticklore.com later with no
  // code change.
  const from = process.env.FROM_EMAIL || "Ticklore <onboarding@resend.dev>";

  const { data, error } = await client.emails.send({
    from,
    to: [to],
    subject: `Your ticket to ${eventName} — Chapter One is written`,
    html: ticketEmailHtml({ eventName, ticketId, viewUrl, custodial }),
    text: ticketEmailText({ eventName, ticketId, viewUrl, custodial }),
  });

  if (error) return { sent: false, reason: error.message || String(error) };
  return { sent: true, id: data?.id };
}

function ticketEmailText({ eventName, ticketId, viewUrl, custodial }) {
  return [
    `Your ticket to ${eventName} is ready.`,
    ``,
    `Ticket #${ticketId} — Chapter One is written.`,
    custodial
      ? `It is held safely for you. No wallet or crypto account required.`
      : `It has been sent to your wallet.`,
    ``,
    viewUrl ? `View your ticket: ${viewUrl}` : ``,
    ``,
    `Every ticket has a story.`,
    `Ticklore`,
  ].filter(Boolean).join("\n");
}

function ticketEmailHtml({ eventName, ticketId, viewUrl, custodial }) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const button = viewUrl
    ? `<a href="${esc(viewUrl)}" style="display:inline-block;background:#C9A227;color:#081619;
         text-decoration:none;font-weight:600;padding:13px 28px;border-radius:5px;
         font-family:Helvetica,Arial,sans-serif;font-size:15px;">View your ticket</a>`
    : "";

  const held = custodial
    ? "It is held safely for you — no wallet or crypto account required."
    : "It has been sent to your wallet.";

  // Inline styles only. Email clients strip <style> blocks and ignore
  // stylesheets, so every rule has to ride on the element itself.
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#0E262B;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0E262B;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:linear-gradient(135deg,#123138,#0a1e23);border:1px solid rgba(227,194,94,0.2);border-radius:12px;">
        <tr><td style="padding:40px 40px 8px;text-align:center;">
          <div style="font-family:Georgia,serif;font-size:26px;font-weight:bold;color:#F1E9DD;letter-spacing:-0.5px;">Tick<span style="color:#E3C25E;">lore</span></div>
          <div style="font-family:Georgia,serif;font-style:italic;font-size:14px;color:#E3C25E;margin-top:4px;">Every ticket has a story.</div>
        </td></tr>
        <tr><td style="padding:24px 40px 8px;text-align:center;">
          <div style="font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#C9A227;">Chapter One is written</div>
          <h1 style="font-family:Georgia,serif;font-weight:600;font-size:24px;color:#F1E9DD;margin:10px 0 0;line-height:1.2;">${esc(eventName)}</h1>
        </td></tr>
        <tr><td style="padding:16px 40px 8px;text-align:center;">
          <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:rgba(241,233,221,0.72);margin:0;">
            Your keepsake ticket <strong style="color:#F1E9DD;">#${esc(ticketId)}</strong> has been minted and is yours to keep.
            ${esc(held)}
          </p>
        </td></tr>
        ${button ? `<tr><td style="padding:24px 40px 8px;text-align:center;">${button}</td></tr>` : ""}
        <tr><td style="padding:28px 40px 40px;text-align:center;border-top:1px solid rgba(241,233,221,0.1);margin-top:20px;">
          <p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:rgba(241,233,221,0.4);margin:16px 0 0;">
            This ticket lives on the blockchain and does not expire. It is a permanent record of your place at this event.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Send the claim receipt — the keepsake email after a claim-code redemption.
 * Same design rule: by now the keepsake exists on-chain; a mail failure costs
 * a notification, never the claim. Always resolves.
 */
async function sendClaimEmail({ to, eventName, ticketId, claimUrl, vaultUrl, owned }) {
  if (!to) return { sent: false, reason: "no email on the claim" };

  const client = getClient();
  if (!client) return { sent: false, reason: "RESEND_API_KEY not set — email disabled" };

  const from = process.env.FROM_EMAIL || "Ticklore <onboarding@resend.dev>";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const heldLine = owned
    ? "It was minted straight into your own wallet — yours, permanently. Your email is the key; there is nothing to install or remember."
    : "It is held safely for you — no wallet or crypto account required.";

  const btn = (url, label, solid) => `<a href="${esc(url)}" style="display:inline-block;${solid
    ? "background:#C9A227;color:#081619;"
    : "background:transparent;color:#E3C25E;border:1px solid #C9A227;"}text-decoration:none;font-weight:600;padding:12px 24px;border-radius:5px;font-family:Helvetica,Arial,sans-serif;font-size:14px;margin:0 6px 8px;">${esc(label)}</a>`;

  const text = [
    `Your keepsake from ${eventName} is claimed.`,
    ``,
    `Keepsake #${ticketId}. ${owned ? "Minted into your own wallet — yours, permanently." : "Held safely for you."}`,
    ``,
    claimUrl ? `See your keepsake: ${claimUrl}` : ``,
    vaultUrl ? `Open the memory vault: ${vaultUrl}` : ``,
    ``,
    `Every ticket has a story.`,
    `Ticklore`,
  ].filter(Boolean).join("\n");

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#0E262B;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0E262B;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:linear-gradient(135deg,#123138,#0a1e23);border:1px solid rgba(227,194,94,0.2);border-radius:12px;">
        <tr><td style="padding:40px 40px 8px;text-align:center;">
          <div style="font-family:Georgia,serif;font-size:26px;font-weight:bold;color:#F1E9DD;letter-spacing:-0.5px;">Tick<span style="color:#E3C25E;">lore</span></div>
          <div style="font-family:Georgia,serif;font-style:italic;font-size:14px;color:#E3C25E;margin-top:4px;">Every ticket has a story.</div>
        </td></tr>
        <tr><td style="padding:24px 40px 8px;text-align:center;">
          <div style="font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#C9A227;">Your keepsake is claimed</div>
          <h1 style="font-family:Georgia,serif;font-weight:600;font-size:24px;color:#F1E9DD;margin:10px 0 0;line-height:1.2;">${esc(eventName)}</h1>
        </td></tr>
        <tr><td style="padding:16px 40px 8px;text-align:center;">
          <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:rgba(241,233,221,0.72);margin:0;">
            Keepsake <strong style="color:#F1E9DD;">#${esc(ticketId)}</strong> is written into the story.
            ${esc(heldLine)}
          </p>
        </td></tr>
        <tr><td style="padding:24px 40px 8px;text-align:center;">
          ${claimUrl ? btn(claimUrl, "See your keepsake", true) : ""}
          ${vaultUrl ? btn(vaultUrl, "Open the memory vault", false) : ""}
        </td></tr>
        <tr><td style="padding:28px 40px 40px;text-align:center;border-top:1px solid rgba(241,233,221,0.1);">
          <p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:rgba(241,233,221,0.4);margin:16px 0 0;">
            This keepsake lives on the blockchain and does not expire. The vault is where its story keeps growing — photos and memories from the night, added over time. Worth revisiting.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const { data, error } = await client.emails.send({
    from, to: [to],
    subject: `Your keepsake from ${eventName} — claimed`,
    html, text,
  });

  if (error) return { sent: false, reason: error.message || String(error) };
  return { sent: true, id: data?.id };
}

module.exports = { sendTicketEmail, sendClaimEmail };
