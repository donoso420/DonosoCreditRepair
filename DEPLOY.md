# Deploy Guide

## Local preview

```bash
cd "/Users/kathy.donoso/Documents/credit repair company"
python3 -m http.server 8080
```

Open `http://localhost:8080`.

## Contact form setup

The website now submits to a backend endpoint (`/api/lead`), which:

1. sends a lead notification email to your private inbox,
2. sends an auto-reply confirmation email to the lead,
3. automatically creates or updates a client portal account in Supabase (when configured),
4. sends the client a secure portal password setup link,
5. optionally forwards lead data to a webhook (Google Sheets or CRM).

Set these environment variables in your hosting platform:

- `RESEND_API_KEY`: your Resend API key.
- `FROM_EMAIL`: sender email verified in Resend (example: `Donoso Credit Repair <noreply@yourdomain.com>`).
- `LEADS_TO_EMAIL`: private destination inbox (optional override). If omitted, default is `donoso420@icloud.com`.
- `LEAD_WEBHOOK_URL` (optional): webhook URL for Google Sheets or CRM lead tracking.
- `SUPABASE_URL`: your Supabase project URL (example: `https://YOUR_PROJECT.supabase.co`).
- `SUPABASE_SERVICE_ROLE_KEY`: your Supabase service role key (server-side only; never expose in frontend).
- `PORTAL_LOGIN_URL`: your live client portal page URL (example: `https://yourdomain.com/portal.html`).
- `PORTAL_REDIRECT_URL` (optional): URL used in the password setup email redirect.
- `AUTO_CREATE_PORTAL_USERS` (optional): `true`/`false` toggle. Defaults to enabled when Supabase env vars exist.

Important:

- `FROM_EMAIL` must be from a verified domain in your Resend account.
- Public visible email on the page can remain different from `LEADS_TO_EMAIL`.
- Local `python3 -m http.server` preview will not run serverless functions.
- If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are missing, lead emails still work but portal auto-onboarding is skipped.

## Deploy to Netlify

1. Create a new Netlify site from this folder/repo.
2. Build command: leave blank.
3. Publish directory: `.`.
4. Add your custom domain in Netlify domain settings.
5. Add environment variables listed above in Site Settings > Environment Variables.

This project already includes `netlify.toml`.

## Deploy to Vercel

1. Import this folder/repo as a new Vercel project.
2. Framework preset: `Other`.
3. Build command: none.
4. Output directory: `.`.
5. Add custom domain in Vercel project settings.
6. Add environment variables listed above in Project Settings > Environment Variables.

This project already includes `vercel.json`.

## Google Sheets lead tracking (optional)

Quick path:

1. Create a Google Sheet for leads.
2. In Google Apps Script, create a web app endpoint that accepts JSON and appends rows.
3. Deploy web app and copy the public URL.
4. Set that URL as `LEAD_WEBHOOK_URL`.

The backend will POST this JSON payload:

- `name`
- `email`
- `phone`
- `goal`
- `message`
- `source`
- `consent`
- `received_at`

## Files to publish

- `index.html`
- `styles.css`
- `app.js`
- `portal.html`
- `portal.css`
- `portal.js`
- `portal-config.js`
- `admin.html`
- `admin.css`
- `admin.js`
- `thank-you.html`
- `terms.html`
- `privacy.html`
- `disclosures.html`
- `cancellation.html`
- `api/lead.js`
- `netlify/functions/lead.js`
