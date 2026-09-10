-- 备考兔 · 上岸工作台 云端同步建表脚本
-- 适用于 Supabase（免费版即可）。在 Supabase 控制台的 SQL Editor 中粘贴并运行。
--
-- 数据模型：单行表，固定 id='main'，data 字段存放加密后的整个工作台 state（JSON 文本）。
-- 同步码（可选）会对 data 做 XOR + base64 加密，拿到 anon key 的人也看不到明文，提升私密性。

create table if not exists workspace_sync (
  id         text primary key default 'main',
  data       text not null,
  updated_at timestamptz default now()
);

-- 预置 id='main' 数据行：PATCH 只能更新已存在的行，空表会导致首次上传静默失败。
-- 重复运行无副作用（on conflict do nothing）。已建过表的老用户可单独运行这一条。
insert into workspace_sync (id, data) values ('main', '') on conflict (id) do nothing;

-- 开启行级安全（RLS）
alter table workspace_sync enable row level security;

-- 使用 anon key 公开读写（小红书方案风格：免费但不设登录）。
-- ⚠️ 安全提示：anon key 可被前端直接拿到，等于任何人知道 URL 都能读写该表。
--    建议配合「同步码」加密 data 内容；若需更强控制，可改为要求登录后写入。
drop policy if exists "allow anon all" on workspace_sync;
create policy "allow anon all"
  on workspace_sync
  for all
  to anon
  using (true)
  with check (true);

-- （可选）若你不想公开写，可改用下面这条：仅允许已登录用户读写
-- create policy "authenticated only" on workspace_sync for all to authenticated using (true) with check (true);
