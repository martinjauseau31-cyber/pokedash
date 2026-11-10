-- ─────────────────────────────────────────────────────────────
--  PokéDash : schéma Supabase
--  À coller dans Supabase > SQL Editor > New query > Run
-- ─────────────────────────────────────────────────────────────

create table if not exists public.lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  source text,
  purchase_date date,
  price numeric(10,2) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lot_id uuid references public.lots(id) on delete set null,
  name text not null,
  set_name text,
  number text,
  language text default 'FR',
  condition text,
  purchase_price numeric(10,2) default 0,
  purchase_date date,
  market_value numeric(10,2) default 0,
  status text not null default 'stock',
  grader text,
  grade numeric(4,1),
  grading_cost numeric(10,2) default 0,
  grading_sent date,
  grading_back date,
  sale_price numeric(10,2),
  sale_fees numeric(10,2) default 0,
  sale_channel text,
  sale_date date,
  listed_date date,
  notes text,
  portfolio text not null default 'business',  -- 'business' (achat-revente) ou 'perso' (ma collection)
  kind text not null default 'card',           -- 'card' ou 'sealed' (produit scellé)
  sealed_type text,                            -- Display, ETB, Coffret, Booster…
  quantity integer not null default 1,
  grading_service text,                        -- formule : Classic, Fast, Standard, Express…
  declared_value numeric(10,2),
  raw_value numeric(10,2),                     -- cote brute au moment de l'envoi au grading
  cert_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  stock_value numeric(12,2) not null default 0,
  invested numeric(12,2) not null default 0,
  sales numeric(12,2) not null default 0,
  perso_value numeric(12,2) not null default 0,
  unique (user_id, date)
);

create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb
);

-- Sécurité : chaque utilisateur ne voit et ne modifie que ses propres lignes
alter table public.lots      enable row level security;
alter table public.cards     enable row level security;
alter table public.snapshots enable row level security;
alter table public.settings  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['lots','cards','snapshots','settings'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;

create index if not exists cards_user_idx on public.cards(user_id);
create index if not exists cards_lot_idx  on public.cards(lot_id);
create index if not exists lots_user_idx  on public.lots(user_id);

-- ─────────────────────────────────────────────────────────────
--  Mise à jour v2 (si ta base a été créée avec l'ancienne version)
--  Sans danger : ne fait rien si les colonnes existent déjà.
-- ─────────────────────────────────────────────────────────────
alter table public.cards add column if not exists portfolio text not null default 'business';
alter table public.cards add column if not exists kind text not null default 'card';
alter table public.cards add column if not exists sealed_type text;
alter table public.cards add column if not exists quantity integer not null default 1;
alter table public.cards add column if not exists grading_service text;
alter table public.cards add column if not exists declared_value numeric(10,2);
alter table public.cards add column if not exists raw_value numeric(10,2);
alter table public.cards add column if not exists cert_number text;
alter table public.snapshots add column if not exists perso_value numeric(12,2) not null default 0;
update public.cards set portfolio = 'perso', status = 'stock' where status = 'perso';
create index if not exists cards_portfolio_idx on public.cards(user_id, portfolio);
