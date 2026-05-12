-- ZENVORA Supabase schema
-- Run this in Supabase SQL Editor after creating your project.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Customer',
  email text not null,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  price numeric(10,2) not null check (price >= 0),
  rating numeric(2,1) not null default 0,
  stock integer not null default 0 check (stock >= 0),
  active boolean not null default true,
  label text not null default 'ITEM',
  color text not null default 'linear-gradient(135deg,#dff2ee,#f8e3d9)',
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'Confirmed',
  payment_method text not null,
  shipping_name text not null,
  shipping_phone text not null,
  shipping_address text not null,
  shipping_city text not null,
  shipping_zip text not null,
  subtotal numeric(10,2) not null default 0,
  shipping numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  price numeric(10,2) not null,
  quantity integer not null check (quantity > 0)
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  text text not null,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), new.email, 'customer')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.decrement_product_stock(product_id_input uuid, amount_input integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.products
  set stock = greatest(stock - amount_input, 0),
      active = case when greatest(stock - amount_input, 0) > 0 then active else false end
  where id = product_id_input;
end;
$$;

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.reviews enable row level security;

drop policy if exists "profiles read own or admin" on public.profiles;
create policy "profiles read own or admin" on public.profiles
for select using (id = auth.uid() or public.is_admin());

drop policy if exists "products public read active" on public.products;
create policy "products public read active" on public.products
for select using (active = true or public.is_admin());

drop policy if exists "products admin insert" on public.products;
create policy "products admin insert" on public.products
for insert with check (public.is_admin());

drop policy if exists "products admin update" on public.products;
create policy "products admin update" on public.products
for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "orders read own or admin" on public.orders;
create policy "orders read own or admin" on public.orders
for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "orders customer insert own" on public.orders;
create policy "orders customer insert own" on public.orders
for insert with check (user_id = auth.uid());

drop policy if exists "order items read own order or admin" on public.order_items;
create policy "order items read own order or admin" on public.order_items
for select using (
  public.is_admin() or exists (
    select 1 from public.orders
    where orders.id = order_items.order_id and orders.user_id = auth.uid()
  )
);

drop policy if exists "order items customer insert own order" on public.order_items;
create policy "order items customer insert own order" on public.order_items
for insert with check (
  exists (
    select 1 from public.orders
    where orders.id = order_items.order_id and orders.user_id = auth.uid()
  )
);

drop policy if exists "reviews public read" on public.reviews;
create policy "reviews public read" on public.reviews
for select using (true);

drop policy if exists "reviews customer insert own" on public.reviews;
create policy "reviews customer insert own" on public.reviews
for insert with check (user_id = auth.uid());

insert into public.products (name, category, price, rating, stock, active, label, color, description) values
('Aurora Smart Watch', 'Tech', 189, 4.8, 14, true, 'WATCH', 'linear-gradient(135deg,#dff2ee,#f8e3d9)', 'A sleek daily smartwatch with health tracking, fast charging, and a polished steel finish.'),
('Sonic Quiet Headphones', 'Tech', 249, 4.7, 9, true, 'AUDIO', 'linear-gradient(135deg,#e9edf4,#d8f0eb)', 'Wireless noise cancelling headphones tuned for clean bass, travel comfort, and long battery life.'),
('Botanical Skin Duo', 'Beauty', 78, 4.9, 7, true, 'CARE', 'linear-gradient(135deg,#edf7ef,#ffe5df)', 'A lightweight cleanser and serum set with plant extracts and everyday hydration.'),
('Curated Gift Box', 'Gifts', 96, 4.8, 18, true, 'GIFT', 'linear-gradient(135deg,#ffe4de,#f8f6ec)', 'A ready-to-send gift set with tasteful essentials, wrapping, and a personal note card.')
on conflict do nothing;

-- After signing up the owner account in the site, run this with your owner email:
-- update public.profiles set role = 'admin' where email = 'your-email@example.com';
