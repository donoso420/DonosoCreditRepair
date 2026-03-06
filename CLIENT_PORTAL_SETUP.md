# Client Portal Setup

This setup gives clients a secure sign-in page where they can view:

- latest credit snapshots
- letters sent with tracking numbers
- account update timeline
- uploaded documents (PDF letter copies and screenshots)

It also includes an admin dashboard for managing those records from a UI.

## Files added

- `portal.html`
- `portal.css`
- `portal.js`
- `portal-config.js`
- `supabase-portal-schema.sql`
- `admin.html`
- `admin.css`
- `admin.js`

## 1) Create Supabase project

1. Go to Supabase and create a new project.
2. In `Project Settings > API`, copy:
- Project URL
- `anon` public key

## 2) Configure portal keys

Edit `portal-config.js`:

```js
window.__PORTAL_CONFIG__ = {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
  companyName: "Donoso Credit Repair",
};
```

## 3) Create tables + RLS policies

1. Open Supabase SQL Editor.
2. Run `supabase-portal-schema.sql`.
   If you already ran an older version, run this latest file again to add `client_files`
   and storage policies.

This creates:

- `client_profiles`
- `admin_users`
- `credit_snapshots`
- `client_letters`
- `client_updates`
- `client_files`

And enables Row Level Security so:

- clients only read rows where `user_id = auth.uid()`
- admin users in `admin_users` can manage client tracker rows
- storage access is scoped per client folder for uploads in `client-docs`

## 4) Enable auth settings

In Supabase Auth:

1. Enable Email provider.
2. Keep email confirmations on.
3. Add your deployed domain (and local dev URL) to redirect URLs:
- `https://your-domain.com/portal.html`
- `http://localhost:8080/portal.html`

## 5) Add client data

For each new client:

1. Create account from portal (`Create Account`) or invite via Supabase Auth admin.
2. Add one row in `client_profiles` with same `user_id`.
3. Add rows in:
- `credit_snapshots` (score updates)
- `client_letters` (tracking numbers + status)
- `client_updates` (timeline notes)

Automatic option:

- If your deployed lead endpoint has `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set, a portal user and `client_profiles` row are auto-created from website lead submissions.
- Client receives a password setup link by email and signs in at your portal URL.

## 6) Set up admin access

1. Create your admin auth account in Supabase Auth.
2. Copy that user `id` (UUID) from Supabase Auth users table.
3. Insert that UUID into `admin_users`:

```sql
insert into public.admin_users (user_id) values ('YOUR_ADMIN_USER_UUID');
```

4. Open `/admin.html` and sign in with the same admin account.

Admin dashboard lets you:

- create/update client profile
- add credit snapshots
- add letters with tracking numbers
- update letter status
- post timeline updates
- upload PDF letters and screenshot attachments per client

## 7) Status values for letter tracking

Use consistent status text in `client_letters.status`, for example:

- `In Transit`
- `Delivered`
- `Response Received`

## 8) File uploads

Uploads are stored in Supabase Storage bucket `client-docs` with object paths like:

- `CLIENT_USER_ID/timestamp-file-name.pdf`

Supported types in admin upload form:

- PDF
- PNG
- JPG/JPEG
- WebP

Max upload size in UI:

- 15MB per file

## 9) Client experience

Client logs into `portal.html` and can view:

- 3 bureau score cards (latest values)
- letter tracking table
- update timeline
- secure file list with signed links

## 10) Important security notes

- Never put your Supabase service role key in frontend files.
- `portal-config.js` should only contain project URL and anon key.
- Keep admin insert/update actions in Supabase dashboard or private backend tools.
