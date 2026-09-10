-- 备考兔 · 上岸工作台 云端同步建表 / 修复脚本
-- 适用于 Supabase 免费版。在 Supabase 控制台 → SQL Editor → 粘贴全部内容 → Run。
-- 幂等设计：可反复运行，不会报错、不会重复建表、不会清空已有数据。
--
-- 数据模型：单行表，固定 id='main'，data 字段存放加密后的整个工作台 state（JSON 文本）。
-- 同步码（可选）会对 data 做 XOR + base64 加密，拿到 anon key 的人也看不到明文。

-- 1. 建表（已存在则跳过）
create table if not exists workspace_sync (
  id         text primary key default 'main',
  data       text not null,
  updated_at timestamptz default now()
);

-- 2. 预置 id='main' 数据行
--    PATCH 只能更新已存在的行，空表会导致首次上传静默失败；有此行则首次上传即可成功。
insert into workspace_sync (id, data) values ('main', '') on conflict (id) do nothing;

-- 3. 授权：让匿名（anon）/ 登录（authenticated）角色都能读写该表
--    缺这一步会报 "permission denied for table"，比 RLS 更底层。
grant usage on schema public to anon, authenticated;
grant all on workspace_sync to anon, authenticated;

-- 4. 关闭行级安全（RLS）——推荐做法
--    关闭后不会再出现 "new row violates row-level security policy" 报错。
--    安全性说明：本表数据已用「同步码」加密，且 anon key 本来就公开在前端，
--    关闭 RLS 不会额外泄露信息；真正保护数据的是同步码，请设置一个足够长的同步码。
alter table workspace_sync disable row level security;

-- 5. 兜底：万一 RLS 被重新开启，也会自动放行（保留一条宽松策略）
drop policy if exists "allow anon all" on workspace_sync;
create policy "allow anon all"
  on workspace_sync
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- 6. 确认结果：应返回一行，rls_enabled = false
select id, length(data) as data_len, updated_at,
       (select relrowsecurity from pg_class where relname = 'workspace_sync') as rls_enabled
from workspace_sync;
