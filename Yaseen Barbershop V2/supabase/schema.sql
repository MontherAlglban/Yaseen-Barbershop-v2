create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create table if not exists public.services (
  id uuid primary key,
  name_ar text not null,
  name_he text not null,
  description_ar text not null default '',
  description_he text not null default '',
  price numeric(10,2) not null check(price >= 0),
  duration_minutes integer not null default 30 check(duration_minutes in (30,60,90)),
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.working_days (
  day_of_week integer primary key check(day_of_week between 0 and 6),
  is_open boolean not null default true,
  open_time time not null default '10:00',
  close_time time not null default '17:00',
  check(close_time > open_time)
);

create table if not exists public.site_settings (
  key text primary key,
  value text not null default ''
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  customer_phone text not null,
  service_id uuid not null references public.services(id),
  booking_date date not null,
  start_time time not null,
  end_time time not null,
  status text not null default 'confirmed' check(status in ('confirmed','cancelled','completed')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  check(end_time > start_time)
);

alter table public.services enable row level security;
alter table public.working_days enable row level security;
alter table public.site_settings enable row level security;
alter table public.bookings enable row level security;

drop policy if exists service_public_select on public.services;
drop policy if exists days_public_select on public.working_days;
drop policy if exists settings_public_select on public.site_settings;
create policy service_public_select on public.services for select using (active = true);
create policy days_public_select on public.working_days for select using (true);
create policy settings_public_select on public.site_settings for select using (true);

insert into public.services (id,name_ar,name_he,description_ar,description_he,price,duration_minutes,sort_order,active)
values
('11111111-1111-4111-8111-111111111111','حلاقة شعر','תספורת','قصة شعر باحتراف ودقة','תספורת מקצועית ומדויקת',30,30,1,true),
('22222222-2222-4222-8222-222222222222','حلاقة شعر مع دقن','תספורת + זקן','ستايل كامل للشعر واللحية','סטייל מלא לשיער ולזקן',50,30,2,true),
('33333333-3333-4333-8333-333333333333','حلاقة شعر للصغار','תספורת לילדים','قصات مرتبة ومناسبة للصغار','תספורת מסודרת לילדים',25,30,3,true)
on conflict (id) do nothing;

insert into public.working_days(day_of_week,is_open,open_time,close_time)
values
(0,true,'10:00','17:00'),(1,true,'10:00','17:00'),(2,true,'10:00','17:00'),(3,true,'10:00','17:00'),(4,true,'10:00','17:00'),(5,false,'10:00','17:00'),(6,false,'10:00','17:00')
on conflict(day_of_week) do nothing;

insert into public.site_settings(key,value) values
('whatsapp','972535245543'),
('location_ar','عرعرة النقب — بجانب مشاوي أبو معروف'),
('location_he','ערערה בנגב — ליד מסעדת אבו מערוף'),
('hours_note_ar','ساعات العمل تحدد من لوحة الإدارة'),
('hours_note_he','שעות הפעילות מנוהלות מלוח הניהול')
on conflict(key) do nothing;


-- Prevent overlapping confirmed appointments, including 60/90-minute services.
drop index if exists bookings_confirmed_slot_idx;
alter table public.bookings drop constraint if exists bookings_confirmed_no_overlap;
alter table public.bookings
  add constraint bookings_confirmed_no_overlap
  exclude using gist (
    booking_date with =,
    tsrange(
      booking_date + start_time,
      booking_date + end_time,
      '[)'
    ) with &&
  ) where (status = 'confirmed');

create or replace function public.book_appointment(p_name text,p_phone text,p_service_id uuid,p_date date,p_start_time time)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.services;
  d public.working_days;
  v_end time;
  result public.bookings;
  dow int;
begin
  if p_date < current_date then raise exception 'slot unavailable'; end if;
  select * into s from public.services where id=p_service_id and active=true;
  if not found then raise exception 'service not available'; end if;
  dow := extract(dow from p_date)::int;
  select * into d from public.working_days where day_of_week=dow;
  if not found or not d.is_open then raise exception 'slot unavailable'; end if;
  v_end := p_start_time + make_interval(mins=>s.duration_minutes);
  if p_start_time < d.open_time or v_end > d.close_time then raise exception 'slot unavailable'; end if;
  if extract(minute from p_start_time)::int not in (0,30) then raise exception 'slot unavailable'; end if;
  if exists (
    select 1 from public.bookings b
    where b.booking_date = p_date
      and b.status = 'confirmed'
      and p_start_time < b.end_time
      and v_end > b.start_time
  ) then raise exception 'slot unavailable'; end if;
  insert into public.bookings(customer_name,customer_phone,service_id,booking_date,start_time,end_time,status)
  values(p_name,p_phone,p_service_id,p_date,p_start_time,v_end,'confirmed')
  returning * into result;
  return result;
exception when exclusion_violation or unique_violation then
  raise exception 'slot unavailable';
end;
$$;


grant execute on function public.book_appointment(text,text,uuid,date,time) to anon, authenticated, service_role;
