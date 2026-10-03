create table if not exists public.admin_codes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  pin_hash text not null unique,
  created_at timestamptz not null default now()
);

alter table public.admin_codes enable row level security;
revoke all on table public.admin_codes from anon, authenticated;
grant select, insert, delete on table public.admin_codes to service_role;

create table if not exists public.admin_pin_attempts (
  fingerprint text primary key,
  window_started_at timestamptz not null,
  attempts integer not null default 0
);

alter table public.admin_pin_attempts enable row level security;
revoke all on table public.admin_pin_attempts from anon, authenticated;
grant select, insert, update, delete on table public.admin_pin_attempts to service_role;

create or replace function public.consume_admin_pin_attempt(
  p_fingerprint text,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed boolean;
begin
  insert into public.admin_pin_attempts (fingerprint, window_started_at, attempts)
  values (p_fingerprint, p_now, 1)
  on conflict (fingerprint) do update
    set window_started_at = case
          when public.admin_pin_attempts.window_started_at <= p_now - interval '15 minutes' then p_now
          else public.admin_pin_attempts.window_started_at
        end,
        attempts = case
          when public.admin_pin_attempts.window_started_at <= p_now - interval '15 minutes' then 1
          else public.admin_pin_attempts.attempts + 1
        end
  returning attempts <= 10 into allowed;

  return allowed;
end;
$$;

revoke all on function public.consume_admin_pin_attempt(text, timestamptz) from public, anon, authenticated;
grant execute on function public.consume_admin_pin_attempt(text, timestamptz) to service_role;