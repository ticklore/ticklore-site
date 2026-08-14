/**
 * lib/ui.js — shared visual language for the buyer-facing pages.
 *
 * One place for the ticket SVG, the design tokens, and the small helpers, so
 * the hero, the shop, an event page, and the success screen all speak the same
 * visual language and a change lands everywhere at once.
 *
 * The ticket SVG here mirrors the on-chain art. Attendees see the same chapter
 * card on the site that the contract draws into their keepsake.
 */

const CHAPTERS = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"];

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function money(cents) {
  return cents === 0 ? "Free" : "$" + (cents / 100).toFixed(2).replace(/\.00$/, "");
}

function formatDate(iso) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatDateShort(iso) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase();
}

function chapter(i) {
  return CHAPTERS[i] || String(i + 1);
}

/**
 * The keepsake ticket as an SVG string. `number` may be a real id or "—" for
 * a preview. `used` stamps ADMITTED. This is intentionally close to the
 * contract's on-chain render.
 */
function ticketSvg({ name, venue, priceCents, number = "—", used = false }) {
  const stamp = used
    ? `<g transform="rotate(-14 400 250)">
         <rect x="250" y="215" width="300" height="70" rx="8" fill="none" stroke="#7FB3A6" stroke-width="3" opacity="0.85"/>
         <text x="400" y="262" fill="#7FB3A6" font-family="monospace" font-size="34" letter-spacing="6" text-anchor="middle" opacity="0.85">ADMITTED</text>
       </g>` : "";
  return `<svg viewBox="0 0 800 500" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Ticklore ticket for ${esc(name)}">
  <defs>
    <linearGradient id="tbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#123138"/><stop offset="0.6" stop-color="#0d262c"/><stop offset="1" stop-color="#0a1e23"/>
    </linearGradient>
    <linearGradient id="spine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2FAF93"/><stop offset="1" stop-color="#C9A227"/>
    </linearGradient>
  </defs>
  <rect width="800" height="500" rx="18" fill="url(#tbg)"/>
  <rect x="0" y="0" width="10" height="500" rx="5" fill="url(#spine)"/>
  <rect x="20" y="20" width="760" height="460" rx="12" fill="none" stroke="#C9A227" stroke-opacity="0.45"/>
  <text x="56" y="76" fill="#E3C25E" font-family="monospace" font-size="22" letter-spacing="9">TICKLORE</text>
  <line x1="56" y1="96" x2="744" y2="96" stroke="#C9A227" stroke-opacity="0.35"/>
  <text x="56" y="222" fill="#C9A227" font-family="monospace" font-size="17" letter-spacing="5">THE STORY</text>
  <text x="56" y="262" fill="#F1E9DD" font-family="Georgia, serif" font-size="44">${esc(name)}</text>
  ${venue ? `<text x="56" y="298" fill="#7FB3A6" font-family="monospace" font-size="17" letter-spacing="1">${esc(venue)}</text>` : ""}
  <text x="56" y="452" fill="#F1E9DD" font-family="monospace" font-size="26">${esc(money(priceCents))}</text>
  <text x="744" y="452" fill="#E3C25E" font-family="Georgia, serif" font-size="38" text-anchor="end">#${esc(number)}</text>
  <text x="56" y="476" fill="#7FB3A6" font-family="monospace" font-size="11" letter-spacing="3" opacity="0.65">EVERY TICKET HAS A STORY</text>
  ${stamp}
</svg>`;
}

/** Shared <head>: fonts + the full design system. Every buyer page uses this. */
/** The site nav: brand + inline links on desktop; under 720px the links
 *  collapse into a hamburger opening a branded dropdown with tap-sized rows.
 *  links = [{ href, label, style? }] */
/**
 * The brand lockup: ART for the mark, TYPE for the words.
 *
 * The old logo baked all three — ticket, wordmark, tagline — into one 336KB
 * PNG. That went soft on retina, couldn't be recoloured, and said nothing to a
 * screen reader. Now the ticket is vector and the words are real text, so the
 * lockup is crisp at any size and the name is actually readable as a name.
 *
 * `size` scales the whole thing from one number; `tagline:false` drops the
 * story line where space is tight (the nav).
 */
function brandLockup({ size = 72, tagline = true, light = false, alt = "Ticklore — every ticket has a story" } = {}) {
  return `<span class="lockup${light ? " lockup--light" : ""}" style="--lk:${size}px">
  <img class="lockup__mark" src="/logo-mark.svg" alt="${esc(alt)}">
  <span class="lockup__words">
    <span class="lockup__word"><span class="lockup__tick">TICK</span><span class="lockup__lore">LORE</span></span>
    ${tagline ? `<span class="lockup__tag">Every ticket has a story</span>` : ""}
  </span>
</span>`;
}

function navBar(links) {
  const a = (l) => `<a href="${l.href}"${l.style ? ` style="${l.style}"` : ""}>${l.label}</a>`;
  return `<nav class="nav">
    <a href="/" class="brand nav__brand" style="text-decoration:none;display:flex;align-items:center">
      ${brandLockup({ size: 60 })}
    </a>
    <span class="nav__links">${links.map(a).join("")}</span>
    <button class="nav__burger" aria-label="Open menu" aria-expanded="false"
      onclick="var m=document.getElementById('mnav');var on=m.classList.toggle('on');this.setAttribute('aria-expanded',on);this.textContent=on?'\\u2715':'\\u2630'">\u2630</button>
    <div class="nav__menu" id="mnav">${links.map((l) => `<a href="${l.href}">${l.label}</a>`).join("")}</div>
  </nav>`;
}

function head(title) {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,700;1,9..144,500&family=IBM+Plex+Mono:wght@400;500&family=Work+Sans:wght@400;500&display=swap" rel="stylesheet">
${LOCKUP_FONT_LINK}
<style>${BASE_CSS}</style>`;
}

/**
 * The lockup's own styles, kept separate because not every page uses BASE_CSS:
 * the wallet and the payment gate carry their own stylesheets, and the brand
 * has to look identical on all of them. Self-contained on purpose — it declares
 * the brand colours it needs rather than assuming a host palette.
 */
const LOCKUP_CSS = `
  :root{
    --brand-gold-lt:#F1C765; --brand-gold:#C19434;
    --brand-green-lt:#C6DCC0; --brand-green:#8FB89A;
    --brand-tag:#7FB3A6;
  }
  /* Everything scales off --lk, the mark's height. */
  .lockup{display:inline-flex;align-items:center;gap:calc(var(--lk) * .17);line-height:1}
  .lockup__mark{height:var(--lk);width:auto;display:block;flex:none}
  .lockup__words{display:flex;flex-direction:column;gap:calc(var(--lk) * .07)}
  .lockup__word{font-family:'Montserrat',system-ui,sans-serif;font-weight:800;
    font-size:calc(var(--lk) * .43);letter-spacing:.005em;white-space:nowrap;display:block}
  /* Two gradients, one word: sage from the heart, gold from the frame. */
  .lockup__tick,.lockup__lore{-webkit-background-clip:text;background-clip:text;color:transparent}
  .lockup__tick{background-image:linear-gradient(180deg,var(--brand-green-lt),var(--brand-green))}
  .lockup__lore{background-image:linear-gradient(180deg,var(--brand-gold-lt),var(--brand-gold))}
  .lockup__tag{font-family:'Work Sans',system-ui,sans-serif;font-weight:500;
    font-size:calc(var(--lk) * .146);letter-spacing:.055em;color:var(--brand-tag);white-space:nowrap}
  /* Clipping a gradient to text paints nothing where it isn't supported, which
     would erase the name entirely. Fall back to solid colour, never to blank. */
  @supports not ((-webkit-background-clip:text) or (background-clip:text)){
    .lockup__tick{color:var(--brand-green-lt);background:none}
    .lockup__lore{color:var(--brand-gold-lt);background:none}
  }
  /* On parchment or paper the screen greens wash out. Same lockup, darker ink —
     add class="lockup lockup--light" anywhere the background is pale, which is
     mostly print: the QR sheet a volunteer carries at a desk. */
  .lockup--light .lockup__tick{background-image:linear-gradient(180deg,#3E6B4C,#2A5138)}
  .lockup--light .lockup__lore{background-image:linear-gradient(180deg,#A8801E,#7C5E14)}
  .lockup--light .lockup__tag{color:#5B6E60}
  @supports not ((-webkit-background-clip:text) or (background-clip:text)){
    .lockup--light .lockup__tick{color:#2A5138}
    .lockup--light .lockup__lore{color:#7C5E14}
  }
  @media (max-width:720px){ .lockup{--lk:46px} .lockup__tag{display:none} }
`;

/** The wordmark face, subset to the letters it draws. */
const LOCKUP_FONT_LINK =
  `<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@800&text=TICKLORE&display=swap" rel="stylesheet">`;

const BASE_CSS = `
  :root{
    --ink:#0E262B; --ink-deep:#081619; --parchment:#F1E9DD;
    --gold:#C9A227; --gold-bright:#E3C25E; --teal:#2FAF93; --sage:#7FB3A6;
    /* Sampled from the mark itself, so the wordmark and the ticket agree. */
    --brand-gold-lt:#F1C765; --brand-gold:#C19434;
    --brand-green-lt:#C6DCC0; --brand-green:#8FB89A;
    --line:rgba(241,233,221,.12); --field:rgba(241,233,221,.05);
  }
  *{margin:0;padding:0;box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{background:var(--ink);color:var(--parchment);font-family:'Work Sans',sans-serif;line-height:1.55;-webkit-font-smoothing:antialiased}
  .mono{font-family:'IBM Plex Mono',monospace}
  a{color:inherit}
  body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;
    background:radial-gradient(1200px 600px at 15% -10%,rgba(47,175,147,.06),transparent 60%),
               radial-gradient(900px 500px at 110% 10%,rgba(201,162,39,.05),transparent 55%)}
  .wrap{position:relative;z-index:1;max-width:960px;margin:0 auto;padding:0 24px}
  .brand{font-family:'Fraunces',serif;font-weight:600;letter-spacing:-.01em}
  .brand em{font-style:italic;color:var(--gold-bright)}
${LOCKUP_CSS}
  .btn{display:inline-block;font-family:'Work Sans',sans-serif;font-size:.95rem;font-weight:500;
    background:var(--gold);color:var(--ink-deep);border:0;border-radius:5px;padding:13px 26px;
    cursor:pointer;text-decoration:none;transition:background .18s,transform .18s;white-space:nowrap}
  .btn:hover{background:var(--gold-bright);transform:translateY(-1px)}
  .btn:focus-visible{outline:2px solid var(--gold-bright);outline-offset:3px}
  .btn:disabled{opacity:.6;cursor:wait;transform:none}
  .btn--ghost{background:transparent;color:var(--parchment);border:1px solid var(--line)}
  .btn--ghost:hover{background:transparent;border-color:var(--gold)}
  html,body{max-width:100%;overflow-x:hidden}
  img,svg,video{max-width:100%}
  .nav__brand img{height:72px;width:auto;display:block}
  .nav__links{display:flex;gap:22px;align-items:center}
  .nav__burger{display:none;background:none;border:1px solid var(--line);color:var(--gold-bright);
    font-size:1.25rem;line-height:1;padding:8px 13px;border-radius:9px;cursor:pointer}
  .nav__menu{display:none}
  @media (max-width:720px){
    .nav__brand img{height:52px}
    .nav__links{display:none}
    .nav__burger{display:block}
    .nav__menu.on{display:block;position:absolute;top:100%;left:12px;right:12px;z-index:60;
      background:rgba(8,22,25,.97);border:1px solid var(--line);border-radius:14px;padding:8px;
      backdrop-filter:blur(10px);box-shadow:0 26px 60px -20px rgba(0,0,0,.85)}
    .nav__menu a{display:block;padding:15px 18px;font-size:1.02rem;border-radius:9px;
      color:var(--parchment);text-decoration:none}
    .nav__menu a:active{background:rgba(241,233,221,.07)}
    .nav__menu a + a{border-top:1px solid var(--line)}
  }
  .nav{position:relative;z-index:30;display:flex;align-items:center;justify-content:space-between;
    max-width:960px;margin:0 auto;padding:22px 24px}
  .nav .brand{font-size:1.4rem}
  .nav a{text-decoration:none;font-size:.9rem;color:rgba(241,233,221,.7)}
  .nav a:hover{color:var(--parchment)}
  @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

module.exports = { esc, money, formatDate, formatDateShort, chapter, ticketSvg, head, navBar, brandLockup, LOCKUP_CSS, LOCKUP_FONT_LINK, BASE_CSS };
