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

create table if not exists public.catalog_state (
  id boolean primary key default true check (id),
  section_config jsonb not null,
  logo_image text,
  seed_complete boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.catalog_state enable row level security;
revoke all on table public.catalog_state from anon, authenticated;
grant select, update on table public.catalog_state to service_role;

create table if not exists public.catalog_items (
  id text primary key,
  section_key text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists catalog_items_section_created_idx
  on public.catalog_items (section_key, created_at);

alter table public.catalog_items enable row level security;
revoke all on table public.catalog_items from anon, authenticated;
grant select, insert, update, delete on table public.catalog_items to service_role;

insert into public.catalog_state (id, section_config, seed_complete)
values (
  true,
  '{
    "playingCards":{"label":"Playing Cards","type":"playingCard","fields":["name","image","description"]},
    "powerups":{"label":"Powerups","type":"powerup","fields":["name","image","description"]},
    "currency":{"label":"Currency","type":"currency","fields":["name","image","description"]},
    "joker":{"label":"Joker","type":"joker","fields":["name","image","description","requiredPowerups","howToObtain"]},
    "ace":{"label":"Ace","type":"ace","fields":["name","image","description"]},
    "fate":{"label":"Fate","type":"fate","fields":["name","image","description"]},
    "minigame":{"label":"Minigame","type":"minigame","fields":["name","image","description"]},
    "prestige":{"label":"Prestige Achievements","type":"prestige","fields":["name","image","description","requirement","buff"]},
    "challenges":{"label":"Challenges","type":"challenge","fields":["name","image","description","completeRules"]},
    "trophies":{"label":"Trophies","type":"trophy","fields":["name","image","description","requirement","buff"]}
  }'::jsonb,
  false
)
on conflict (id) do nothing;

do $$
begin
  if not (select seed_complete from public.catalog_state where id = true) then
    insert into public.catalog_items (id, section_key, data) values
      ('pc-royal-red', 'playingCards', '{"id":"pc-royal-red","name":"Royal Red","image":"A♠","description":"Playing Card","section":"playingCards","type":"playingCard","tint":"card-red"}'::jsonb),
      ('pc-midnight-black', 'playingCards', '{"id":"pc-midnight-black","name":"Midnight Black","image":"K♥","description":"Playing Card","section":"playingCards","type":"playingCard","tint":"card-black"}'::jsonb),
      ('pu-royal-swap', 'powerups', '{"id":"pu-royal-swap","name":"Royal Swap","image":"⚡","description":"Reorders the top two cards and keeps a lucky spread on the table.","section":"powerups","type":"powerup","tint":"gold"}'::jsonb),
      ('pu-vault-glow', 'powerups', '{"id":"pu-vault-glow","name":"Vault Glow","image":"✦","description":"Adds a shimmer to the next hand and reveals a safe card target.","section":"powerups","type":"powerup","tint":"amber"}'::jsonb),
      ('cur-coin', 'currency', '{"id":"cur-coin","name":"SpadeZ Coin","image":"◈","description":"Currency","section":"currency","type":"currency","tint":"gold"}'::jsonb),
      ('cur-bonus', 'currency', '{"id":"cur-bonus","name":"Lucky Chips","image":"◆","description":"Currency","section":"currency","type":"currency","tint":"silver"}'::jsonb),
      ('jk-archivist', 'joker', '{"id":"jk-archivist","name":"Archivist Joker","image":"🃏","description":"Turns every third hand into a full-stack reveal phase with a higher payout ceiling.","section":"joker","type":"joker","requiredPowerups":"Royal Swap, Vault Glow","howToObtain":"Complete the morning ledger challenge and buy the vault archive upgrade.","tint":"joker"}'::jsonb),
      ('ace-crest', 'ace', '{"id":"ace-crest","name":"Ace Crest","image":"A","description":"An ace sigil that marks your best opening hand with a bright gold foil edge.","section":"ace","type":"ace","tint":"gold"}'::jsonb),
      ('ft-thread', 'fate', '{"id":"ft-thread","name":"Fate Thread","image":"⟡","description":"A red-thread charm that nudges the table luck meter during big-stakes rounds.","section":"fate","type":"fate","tint":"rose"}'::jsonb),
      ('mg-fortune', 'minigame', '{"id":"mg-fortune","name":"Fortune Loop","image":"▣","description":"A quick draw event that stacks multiplier chips for a bonus round.","section":"minigame","type":"minigame","tint":"mint"}'::jsonb),
      ('pr-ace-legend', 'prestige', '{"id":"pr-ace-legend","name":"Ace Legend","image":"🏆","description":"Reach 12 perfect-deal streaks in the tournament vault.","section":"prestige","type":"prestige","requirement":"12 perfect deal streaks","buff":"+18% payout multiplier for all premium tables.","tint":"gold"}'::jsonb),
      ('ch-royal-dozen', 'challenges', '{"id":"ch-royal-dozen","name":"Royal Dozen","image":"✓","description":"Complete a full hand of gold-suited face cards without risking a bust.","section":"challenges","type":"challenge","completeRules":"Finish 12 rounds while keeping your score below 21 on every turn and using at least one Royal Swap powerup.","tint":"amber"}'::jsonb),
      ('tr-velvet', 'trophies', '{"id":"tr-velvet","name":"Velvet Vault Trophy","image":"🏅","description":"Earned by clearing Elite vault mode in a single live run.","section":"trophies","type":"trophy","requirement":"Complete Elite Vault mode","buff":"+12% table XP for all challenge queues.","tint":"royal"}'::jsonb)
    on conflict (id) do nothing;

    update public.catalog_state set seed_complete = true, updated_at = now() where id = true;
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'spadez-content',
  'spadez-content',
  true,
  3145728,
  array['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view SpadeZ content images" on storage.objects;
create policy "Public can view SpadeZ content images"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'spadez-content');