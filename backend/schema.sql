-- Dr Selam Dental Clinic: run this once in Supabase > SQL Editor

create sequence if not exists patient_seq;

create table if not exists patients (
  card       text primary key default ('DS-' || lpad(nextval('patient_seq')::text, 4, '0')),
  name       text not null,
  phone      text not null,
  email      text default '',
  address    text not null,
  created_at timestamptz not null default now()
);

create table if not exists appointments (
  id         uuid primary key default gen_random_uuid(),
  card       text not null references patients(card) on delete restrict,
  service    text not null,
  date       date not null,
  time       text not null,
  status     text not null default 'Pending'
             check (status in ('Pending','Confirmed','Completed','Cancelled')),
  notes      text default '',
  booked_by  text,
  created_at timestamptz not null default now()
);

-- Two people can never hold the same slot (cancelled ones free it up)
create unique index if not exists one_booking_per_slot
  on appointments (date, time) where status <> 'Cancelled';
create index if not exists appointments_card_idx on appointments (card);
create index if not exists appointments_date_idx on appointments (date);

-- Lock the tables: only the API (service role key) can read or write.
alter table patients     enable row level security;
alter table appointments enable row level security;
-- No policies on purpose. Never put the service role key in the website.

-- Optional demo data
insert into patients (name, phone, email, address) values
  ('Abel Tesfaye','0911000001','abel@mail.com','Bole, Addis Ababa'),
  ('Meron Bekele','0911000002','','Piassa, Addis Ababa')
on conflict do nothing;
