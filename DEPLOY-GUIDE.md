# Deploying Ticklore — Step by Step

This folder has everything needed: `index.html`, `about.html`, and a `_headers`
file that adds the password gate. Follow these steps in order.

---

## Step 1 — Put the files on GitHub

1. Go to github.com and create a **new repository** (top right → "New").
   - Name it something like `ticklore-site`
   - Set it to **Private** (extra layer of privacy, though the password gate
     is what actually protects the live site)
   - Don't add a README/gitignore — keep it empty
2. On the new repo's page, click **"uploading an existing file"** and drag in
   all three files from this folder: `index.html`, `about.html`, `_headers`.
3. Commit the files (the green button).

That's it for GitHub — no command line needed if you use the web upload.

---

## Step 2 — Connect it to Netlify (free hosting)

1. Go to **netlify.com** and sign up (use "Sign up with GitHub" — makes the
   next step automatic).
2. Click **"Add new site" → "Import an existing project"**.
3. Choose **GitHub**, then select your `ticklore-site` repo.
4. Deploy settings: leave everything default (no build command needed since
   this is a plain HTML site) and click **Deploy**.
5. Within a minute or two, Netlify gives you a live URL like
   `random-name-123.netlify.app`. Open it — you should see a browser login
   popup before the site loads. That's the password gate working.

**Default credentials right now (change these before sharing with anyone):**
- Username: `ticklore`
- Password: `story2026`

---

## Step 3 — Change the password to something real

1. In your GitHub repo, open the `_headers` file and click the pencil (edit) icon.
2. Change this line to whatever you want:
   ```
   Basic-Auth: ticklore:story2026
   ```
   Format is `username:password` — e.g. `Basic-Auth: partners:sullivan2026`
3. Commit the change. Netlify auto-redeploys within a minute — no extra steps.

---

## Step 4 — Point your GoDaddy domain at Netlify

1. In Netlify: go to your site → **"Domain settings"** → **"Add a domain"** →
   type `ticklore.com` → follow the prompt to add it.
2. Netlify will show you DNS records to set (usually one **A record** for the
   root domain and one **CNAME** for `www`).
3. Go to **GoDaddy → My Products → DNS** for ticklore.com.
4. Add/edit the records GoDaddy already has to match what Netlify gave you:
   - Delete GoDaddy's default "parked page" A record if present
   - Add the **A record** Netlify shows (usually points to `75.2.60.5`, but
     use whatever Netlify's screen actually says — it can change)
   - Add the **CNAME** for `www` pointing to your `*.netlify.app` address
5. Save. DNS changes can take anywhere from a few minutes to a few hours to
   go live.
6. Back in Netlify, once it detects the DNS is pointed correctly, it will
   auto-issue a free SSL certificate (the padlock/https) — no action needed,
   just wait a few minutes after DNS resolves.

---

## After that

- Visiting `ticklore.com` will show the password prompt first, then the site.
- Anyone you want to see it — investors, partners — just needs the
  username/password you set in Step 3.
- Updating the site later: edit `index.html` or `about.html` directly in
  GitHub (pencil icon → edit → commit), and Netlify redeploys automatically.

If anything doesn't match what you're seeing on screen at any step, tell me
exactly what you're looking at and I'll walk you through that specific part.
