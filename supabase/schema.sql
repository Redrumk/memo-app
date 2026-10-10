-- Memo 앱 Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하면 됩니다. 여러 번 실행해도 안전합니다.

create table if not exists public.folders (
  id          uuid primary key,
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);

create table if not exists public.notes (
  id          uuid primary key,
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  folder_id   uuid references public.folders(id) on delete set null,
  title       text not null default '',
  blocks      jsonb not null default '[]'::jsonb,
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);
-- 페이지 계층·아이콘·커버 (이전 버전 테이블에도 안전하게 추가)
alter table public.notes add column if not exists parent_id uuid;
alter table public.notes add column if not exists icon text not null default '';
alter table public.notes add column if not exists cover text not null default '';
create index if not exists notes_folder_idx on public.notes(folder_id);
create index if not exists notes_parent_idx on public.notes(parent_id);
create index if not exists notes_owner_idx on public.notes(owner_id);

-- 공유 폴더에 참여한 사람
create table if not exists public.folder_members (
  folder_id  uuid not null references public.folders(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (folder_id, user_id)
);

-- 공유 링크(링크를 받은 사람이 로그인하면 해당 폴더 멤버가 된다)
create table if not exists public.share_links (
  token      text primary key default replace(gen_random_uuid()::text, '-', ''),
  folder_id  uuid not null references public.folders(id) on delete cascade,
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 폴더 접근 권한: 소유자이거나 멤버
create or replace function public.can_access_folder(fid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from folders f where f.id = fid and f.owner_id = auth.uid())
      or exists (select 1 from folder_members m where m.folder_id = fid and m.user_id = auth.uid());
$$;

-- 공유 링크로 참여
create or replace function public.join_share(t text)
returns uuid language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select folder_id into fid from share_links where token = t;
  if fid is null then raise exception '유효하지 않은 공유 링크입니다'; end if;
  insert into folder_members(folder_id, user_id) values (fid, auth.uid()) on conflict do nothing;
  return fid;
end $$;

revoke all on function public.join_share(text) from public, anon;
grant execute on function public.join_share(text) to authenticated;
grant execute on function public.can_access_folder(uuid) to authenticated;

alter table public.folders        enable row level security;
alter table public.notes          enable row level security;
alter table public.folder_members enable row level security;
alter table public.share_links    enable row level security;

-- folders
drop policy if exists folders_select on public.folders;
drop policy if exists folders_insert on public.folders;
drop policy if exists folders_update on public.folders;
drop policy if exists folders_delete on public.folders;
create policy folders_select on public.folders for select to authenticated using (public.can_access_folder(id));
create policy folders_insert on public.folders for insert to authenticated with check (owner_id = auth.uid());
-- 공유받은 사람은 이름 변경은 가능하지만 섹션 삭제(deleted=true)는 소유자만
create policy folders_update on public.folders for update to authenticated
  using (public.can_access_folder(id))
  with check (owner_id = auth.uid() or (public.can_access_folder(id) and deleted = false));
create policy folders_delete on public.folders for delete to authenticated using (owner_id = auth.uid());

-- notes: 내 메모 + 내가 접근 가능한 폴더의 메모
drop policy if exists notes_select on public.notes;
drop policy if exists notes_insert on public.notes;
drop policy if exists notes_update on public.notes;
drop policy if exists notes_delete on public.notes;
create policy notes_select on public.notes for select to authenticated
  using (owner_id = auth.uid() or (folder_id is not null and public.can_access_folder(folder_id)));
create policy notes_insert on public.notes for insert to authenticated
  with check (owner_id = auth.uid() and (folder_id is null or public.can_access_folder(folder_id)));
create policy notes_update on public.notes for update to authenticated
  using (owner_id = auth.uid() or (folder_id is not null and public.can_access_folder(folder_id)))
  with check (owner_id = auth.uid() or (folder_id is not null and public.can_access_folder(folder_id)));
create policy notes_delete on public.notes for delete to authenticated
  using (owner_id = auth.uid() or (folder_id is not null and public.can_access_folder(folder_id)));

-- folder_members: 본인 행 또는 폴더 소유자만 보기/삭제(나가기·내보내기). 추가는 join_share 함수로만.
drop policy if exists members_select on public.folder_members;
drop policy if exists members_delete on public.folder_members;
create policy members_select on public.folder_members for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.folders f where f.id = folder_id and f.owner_id = auth.uid()));
create policy members_delete on public.folder_members for delete to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.folders f where f.id = folder_id and f.owner_id = auth.uid()));

-- share_links: 폴더 소유자만 만들고 관리
drop policy if exists links_all on public.share_links;
create policy links_all on public.share_links for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and exists (select 1 from public.folders f where f.id = folder_id and f.owner_id = auth.uid()));
