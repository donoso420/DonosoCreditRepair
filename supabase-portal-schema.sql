-- Client portal schema for Donoso Credit Repair
-- Run in Supabase SQL editor

-- Profiles (one per auth user)
create table if not exists public.client_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now()
);

-- Admin role mapping (who can manage all client tracker data)
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Credit score snapshots (multiple rows over time)
create table if not exists public.credit_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  bureau text not null check (bureau in ('Experian', 'Equifax', 'TransUnion')),
  score integer not null check (score >= 300 and score <= 850),
  reported_at date not null,
  created_at timestamptz not null default now()
);

-- Letter tracking rows (one row per mailed letter)
create table if not exists public.client_letters (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  sent_date date not null,
  bureau text,
  recipient text,
  tracking_number text not null,
  status text not null default 'In Transit',
  notes text,
  created_at timestamptz not null default now()
);

-- Timeline/account updates
create table if not exists public.client_updates (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  details text not null,
  created_at timestamptz not null default now()
);

-- Uploaded files (PDF letters, screenshots, attachments)
create table if not exists public.client_files (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null default 'client-docs',
  file_path text not null,
  file_name text not null,
  content_type text,
  file_size bigint,
  category text not null default 'Other',
  title text,
  notes text,
  created_at timestamptz not null default now()
);

-- Enable Row Level Security
alter table public.client_profiles enable row level security;
alter table public.admin_users enable row level security;
alter table public.credit_snapshots enable row level security;
alter table public.client_letters enable row level security;
alter table public.client_updates enable row level security;
alter table public.client_files enable row level security;

-- Client can read only own records
drop policy if exists "client_profiles_select_own" on public.client_profiles;
create policy "client_profiles_select_own"
on public.client_profiles for select
using (auth.uid() = user_id);

-- Admin table policy (admin can only read their own admin_users row)
drop policy if exists "admin_users_select_own" on public.admin_users;
create policy "admin_users_select_own"
on public.admin_users for select
using (auth.uid() = user_id);

-- Admin can manage all rows on portal tables
drop policy if exists "admin_manage_client_profiles" on public.client_profiles;
create policy "admin_manage_client_profiles"
on public.client_profiles for all
using (
  exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
  )
);

drop policy if exists "credit_snapshots_select_own" on public.credit_snapshots;
create policy "credit_snapshots_select_own"
on public.credit_snapshots for select
using (auth.uid() = user_id);

drop policy if exists "admin_manage_credit_snapshots" on public.credit_snapshots;
create policy "admin_manage_credit_snapshots"
on public.credit_snapshots for all
using (
  exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
  )
);

drop policy if exists "client_letters_select_own" on public.client_letters;
create policy "client_letters_select_own"
on public.client_letters for select
using (auth.uid() = user_id);

drop policy if exists "admin_manage_client_letters" on public.client_letters;
create policy "admin_manage_client_letters"
on public.client_letters for all
using (
  exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
  )
);

drop policy if exists "client_updates_select_own" on public.client_updates;
create policy "client_updates_select_own"
on public.client_updates for select
using (auth.uid() = user_id);

drop policy if exists "admin_manage_client_updates" on public.client_updates;
create policy "admin_manage_client_updates"
on public.client_updates for all
using (
  exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
  )
);

drop policy if exists "client_files_select_own" on public.client_files;
create policy "client_files_select_own"
on public.client_files for select
using (auth.uid() = user_id);

drop policy if exists "admin_manage_client_files" on public.client_files;
create policy "admin_manage_client_files"
on public.client_files for all
using (
  exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
  )
);

-- Optional: allow user to create/update own profile
drop policy if exists "client_profiles_insert_own" on public.client_profiles;
create policy "client_profiles_insert_own"
on public.client_profiles for insert
with check (auth.uid() = user_id);

drop policy if exists "client_profiles_update_own" on public.client_profiles;
create policy "client_profiles_update_own"
on public.client_profiles for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Admin note:
-- Insert/update/delete on tracker tables is restricted by admin_users policy.

-- ── NEW: Portal messaging (two-way client ↔ admin) ─────────────────────────
create table if not exists public.portal_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  sender_role text not null check (sender_role in ('client', 'admin')),
  content text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.portal_messages enable row level security;

-- Client can read and insert their own messages
drop policy if exists "messages_select_own" on public.portal_messages;
create policy "messages_select_own"
on public.portal_messages for select
using (auth.uid() = user_id);

drop policy if exists "messages_insert_own" on public.portal_messages;
create policy "messages_insert_own"
on public.portal_messages for insert
with check (auth.uid() = user_id and sender_role = 'client');

-- Admin can manage all messages
drop policy if exists "admin_manage_messages" on public.portal_messages;
create policy "admin_manage_messages"
on public.portal_messages for all
using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()))
with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

-- ── NEW: Track who uploaded each file (admin vs client) ────────────────────
alter table public.client_files
  add column if not exists uploaded_by text not null default 'admin'
  check (uploaded_by in ('admin', 'client'));

-- Allow clients to insert their own file records
drop policy if exists "client_files_insert_own" on public.client_files;
create policy "client_files_insert_own"
on public.client_files for insert
with check (auth.uid() = user_id and uploaded_by = 'client');

-- Allow clients to upload to their own folder in storage
drop policy if exists "client_upload_own_docs" on storage.objects;
create policy "client_upload_own_docs"
on storage.objects for insert
with check (
  bucket_id = 'client-docs'
  and split_part(name, '/', 1) = auth.uid()::text
);

-- Storage bucket for client attachments
insert into storage.buckets (id, name, public)
values ('client-docs', 'client-docs', false)
on conflict (id) do nothing;

-- Storage policies: client can read only their own folder; admin can manage all
drop policy if exists "client_docs_select_own" on storage.objects;
create policy "client_docs_select_own"
on storage.objects for select
using (
  bucket_id = 'client-docs'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "admin_manage_client_docs" on storage.objects;
create policy "admin_manage_client_docs"
on storage.objects for all
using (
  bucket_id = 'client-docs'
  and exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
  )
)
with check (
  bucket_id = 'client-docs'
  and exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
  )
);

-- ── NEW: Credit report summaries tied to uploaded documents ────────────────
create table if not exists public.credit_reports (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  bureau text not null default 'Other',
  report_date date,
  score integer check (score is null or (score >= 300 and score <= 850)),
  report_label text,
  summary text,
  source text not null default 'manual'
    check (source in ('manual', 'scanned', 'admin_upload', 'client_upload')),
  verification_status text not null default 'pending',
  verification_method text not null default 'manual',
  verification_notes text,
  verified_at timestamptz,
  ai_model text,
  fingerprint text not null,
  file_id bigint references public.client_files(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.credit_reports
  add column if not exists bureau text not null default 'Other',
  add column if not exists report_date date,
  add column if not exists score integer,
  add column if not exists report_label text,
  add column if not exists summary text,
  add column if not exists source text not null default 'manual',
  add column if not exists verification_status text not null default 'pending',
  add column if not exists verification_method text not null default 'manual',
  add column if not exists verification_notes text,
  add column if not exists verified_at timestamptz,
  add column if not exists ai_model text,
  add column if not exists fingerprint text,
  add column if not exists file_id bigint references public.client_files(id) on delete set null,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists credit_reports_user_fingerprint_idx
on public.credit_reports (user_id, fingerprint);

alter table public.credit_reports enable row level security;

drop policy if exists "credit_reports_select_own" on public.credit_reports;
create policy "credit_reports_select_own"
on public.credit_reports for select
using (auth.uid() = user_id);

drop policy if exists "admin_manage_credit_reports" on public.credit_reports;
create policy "admin_manage_credit_reports"
on public.credit_reports for all
using (
  exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
  )
);

-- ── NEW: Negative items found on credit reports or bureau responses ────────
create table if not exists public.negative_items (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  bureau text,
  creditor text not null,
  item_type text not null,
  account_reference text,
  status text,
  balance numeric(12, 2),
  notes text,
  is_active boolean not null default true,
  source text not null default 'manual'
    check (source in ('manual', 'scanned')),
  verification_method text not null default 'manual',
  verification_notes text,
  evidence_excerpt text,
  verified_at timestamptz,
  ai_model text,
  confidence numeric(4, 3),
  fingerprint text not null,
  source_file_id bigint references public.client_files(id) on delete set null,
  report_id bigint references public.credit_reports(id) on delete set null,
  last_seen_at date,
  created_at timestamptz not null default now()
);

alter table public.negative_items
  add column if not exists bureau text,
  add column if not exists account_reference text,
  add column if not exists status text,
  add column if not exists balance numeric(12, 2),
  add column if not exists notes text,
  add column if not exists is_active boolean not null default true,
  add column if not exists source text not null default 'manual',
  add column if not exists verification_method text not null default 'manual',
  add column if not exists verification_notes text,
  add column if not exists evidence_excerpt text,
  add column if not exists verified_at timestamptz,
  add column if not exists ai_model text,
  add column if not exists confidence numeric(4, 3),
  add column if not exists fingerprint text,
  add column if not exists source_file_id bigint references public.client_files(id) on delete set null,
  add column if not exists report_id bigint references public.credit_reports(id) on delete set null,
  add column if not exists last_seen_at date,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists negative_items_user_fingerprint_idx
on public.negative_items (user_id, fingerprint);

alter table public.negative_items enable row level security;

drop policy if exists "negative_items_select_own" on public.negative_items;
create policy "negative_items_select_own"
on public.negative_items for select
using (auth.uid() = user_id);

drop policy if exists "admin_manage_negative_items" on public.negative_items;
create policy "admin_manage_negative_items"
on public.negative_items for all
using (
  exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
  )
);
