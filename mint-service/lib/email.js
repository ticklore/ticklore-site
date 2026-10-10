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

/** The email a card buyer gets the moment their payment lands: their claim
 *  link — a purchased code, delivered instead of printed. */
/**
 * The claim link(s) after a card sale.
 *
 * Takes `claimUrls` (an array) or the older single `claimUrl`. One payment can
 * buy several seats, and each seat is its OWN keepsake — so the email hands
 * over one link per ticket and says plainly that they're forwardable. That is
 * the whole mechanism by which a date or a family member ends up holding their
 * own keepsake rather than a screenshot of someone else's.
 */
const magic = require("./magic");

async function sendCodeEmail({ to, eventName, claimUrl, claimUrls, priceCents }) {
  const urls = (Array.isArray(claimUrls) && claimUrls.length ? claimUrls : [claimUrl]).filter(Boolean);
  const many = urls.length > 1;
  // Each link carries its one-tap token (lib/magic.js) so the buyer never has
  // to go and find a code. The QR is assembled from the code rather than
  // patched onto the finished URL — append a query to the latter and the
  // ".png" lands after it, and the image 404s in every inbox.
  const links = urls.map((u) => {
    const tail = String(u).split("/claim/")[1] || "";
    const t = tail ? magic.sign(decodeURIComponent(tail)) : "";
    return {
      tap: t ? `${u}?t=${t}` : u,
      qr: u.replace("/claim/", "/qr/") + ".png" + (t ? `?t=${t}` : ""),
    };
  });
  const { Resend } = require("resend");
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: "RESEND_API_KEY not set" };
  if (!to) return { sent: false, reason: "buyer email missing" };
  const from = process.env.FROM_EMAIL || "Ticklore <onboarding@resend.dev>";
  const price = priceCents ? `$${(priceCents / 100).toFixed(2).replace(/\.00$/, "")}` : "";

  const { data, error } = await new Resend(key).emails.send({
    from,
    to: [to],
    subject: many ? `Your ${urls.length} tickets to ${eventName} 🎟` : `Your ticket to ${eventName} 🎟`,
    html: `
<div style="background:#0E262B;padding:36px 20px;font-family:Georgia,serif;color:#F1E9DD">
  <div style="max-width:480px;margin:0 auto;text-align:center">
    <div style="font-size:22px;font-weight:600;margin-bottom:4px">Tick<span style="font-style:italic;color:#E3C25E">lore</span></div>
    <div style="font-style:italic;color:#E3C25E;font-size:14px;margin-bottom:26px">Every ticket has a story.</div>
    <div style="font-size:19px;margin-bottom:8px">You're going to ${eventName}.</div>
    <div style="color:#7FB3A6;font-size:14px;margin-bottom:26px">${price ? `Paid ${price} · ` : ""}${
      many ? `${urls.length} keepsake tickets, one tap each.` : "Your keepsake ticket is one tap away."
    }</div>
    ${links.map((L, i) => `<a href="${L.tap}" style="display:inline-block;background:#C9A227;color:#081619;text-decoration:none;
       padding:14px 30px;border-radius:8px;font-weight:600;font-size:16px;margin-bottom:10px">${
         many ? `Claim ticket ${i + 1} of ${urls.length} &rarr;` : "Claim my keepsake &rarr;"
       }</a><br>
       <img src="${L.qr}" width="160" height="160"
            alt="Scan to open your ticket"
            style="display:block;margin:14px auto 6px;border-radius:10px;background:#F1E9DD;padding:7px">
       <div style="color:rgba(241,233,221,.5);font-size:11.5px;margin-bottom:20px">
         Reading this on your phone? <b>Point another phone&rsquo;s camera at this square</b> to open your ticket there instead.
       </div>`).join("")}
    <div style="color:rgba(241,233,221,.55);font-size:12px;margin-top:18px;line-height:1.6">
      ${many
        ? `Each link is its own ticket. <b>Forward one to each guest</b> and the keepsake becomes theirs, in their own name.<br>Keep them safe like cash — anyone holding a link can claim it.`
        : `This link IS your ticket — keep it safe like cash, and don't share it.`}<br>
      No wallet, no app, no crypto anything required.</div>
  </div>
</div>`,
    text: `You're going to ${eventName}. ${price ? `Paid ${price}. ` : ""}${
      many
        ? `Here are your ${urls.length} tickets — each link is its own keepsake, so forward one to each guest:\n\n${links.map((L, i) => `Ticket ${i + 1}: ${L.tap}`).join("\n")}\n\nKeep them safe like cash — anyone holding a link can claim it.`
        : `Claim your keepsake ticket: ${links[0].tap}\nThis link IS your ticket — keep it safe and don't share it.`
    }`,
  });
  if (error) return { sent: false, reason: error.message || String(error) };
  return { sent: true, id: data?.id };
}

/** The roster invite (the Serenity play): they registered through the
 *  organizer's own system; this email hands them their keepsake claim link.
 *  Warm, quiet copy — no prices, no hype; some recipients value discretion. */
async function sendRosterEmail({ to, eventName, claimUrl }) {
  const { Resend } = require("resend");
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: "RESEND_API_KEY not set" };
  if (!to) return { sent: false, reason: "recipient missing" };
  const from = process.env.FROM_EMAIL || "Ticklore <onboarding@resend.dev>";

  const { data, error } = await new Resend(key).emails.send({
    from,
    to: [to],
    subject: `Your keepsake from ${eventName} is waiting 🎟`,
    html: `
<div style="background:#0E262B;padding:36px 20px;font-family:Georgia,serif;color:#F1E9DD">
  <div style="max-width:480px;margin:0 auto;text-align:center">
    <div style="font-size:22px;font-weight:600;margin-bottom:4px">Tick<span style="font-style:italic;color:#E3C25E">lore</span></div>
    <div style="font-style:italic;color:#E3C25E;font-size:14px;margin-bottom:26px">Every ticket has a story.</div>
    <div style="font-size:19px;margin-bottom:8px">You're part of ${eventName}.</div>
    <div style="color:#7FB3A6;font-size:14px;margin-bottom:26px">A permanent keepsake of it is yours to claim — one tap, your email, done.</div>
    <a href="${claimUrl}" style="display:inline-block;background:#C9A227;color:#081619;text-decoration:none;
       padding:14px 30px;border-radius:8px;font-weight:600;font-size:16px">Claim my keepsake &rarr;</a>
    <div style="color:rgba(241,233,221,.55);font-size:12px;margin-top:24px;line-height:1.6">
      This link is yours alone — please don't forward it.<br>
      No wallet, no app, no cost. First name is plenty.</div>
  </div>
</div>`,
    text: `You're part of ${eventName}. A permanent keepsake of it is yours to claim: ${claimUrl}\nThis link is yours alone — please don't forward it. No wallet, no app, no cost.`,
  });
  if (error) return { sent: false, reason: error.message || String(error) };
  return { sent: true, id: data?.id };
}

/** Thanks for a gift. Deliberately says NOTHING about tax deductibility:
 *  whether a gift is deductible depends on the organization's status and on
 *  what the giver received in return, and that is their treasurer's letter to
 *  write, not ours. We confirm the amount and point at them. */
async function sendDonationEmail({ to, eventName, amountCents }) {
  const { Resend } = require("resend");
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: "RESEND_API_KEY not set" };
  if (!to) return { sent: false, reason: "donor email missing" };
  const from = process.env.FROM_EMAIL || "Ticklore <onboarding@resend.dev>";
  const amount = `$${(amountCents / 100).toFixed(2).replace(/\.00$/, "")}`;
  const forWhat = eventName ? ` to ${eventName}` : "";

  const { data, error } = await new Resend(key).emails.send({
    from,
    to: [to],
    subject: `Thank you for your gift${forWhat}`,
    html: `
<div style="background:#0E262B;padding:36px 20px;font-family:Georgia,serif;color:#F1E9DD">
  <div style="max-width:480px;margin:0 auto;text-align:center">
    <div style="font-size:22px;font-weight:600;margin-bottom:4px">Tick<span style="font-style:italic;color:#E3C25E">lore</span></div>
    <div style="font-style:italic;color:#E3C25E;font-size:14px;margin-bottom:26px">Every ticket has a story.</div>
    <div style="font-size:19px;margin-bottom:8px">Thank you for your gift of ${amount}${forWhat}.</div>
    <div style="color:#7FB3A6;font-size:14px;margin-bottom:26px">
      It went directly to the organizers — Ticklore took no part of it.</div>
    <div style="color:rgba(241,233,221,.55);font-size:12px;line-height:1.6">
      Your card receipt comes from Stripe. For anything else the organizers are the
      people to ask — the gift is theirs, and so are their records.</div>
  </div>
</div>`,
    text: `Thank you for your gift of ${amount}${forWhat}. It went directly to the organizers — Ticklore took no part of it. Your card receipt comes from Stripe; for anything further, the organizers hold the records.`,
  });
  if (error) return { sent: false, reason: error.message || String(error) };
  return { sent: true, id: data?.id };
}

module.exports = { sendTicketEmail, sendClaimEmail, sendCodeEmail, sendRosterEmail, sendDonationEmail };
