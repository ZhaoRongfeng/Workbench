# Supabase 云端同步配置指南（零基础版）

> 目标：让手机 / 平板 / 电脑多端打开同一个网址，数据实时互通。
> 全程免费，约 10 分钟，只需配置一次。

---

## 第一步：注册并创建 Supabase 项目

1. 打开 <https://supabase.com> → 右上角 **Start your project** → 建议直接用 **GitHub 账号登录**（你已有 GitHub）。
2. 登录后点 **New project**：
   - **Name**：随意，如 `shangan-sync`
   - **Database Password**：设置一个密码（这只用于直连数据库，忘了也不影响本方案，页面里有重置入口）
   - **Region**：选 **Singapore** 或 **Tokyo**（离国内近，延迟低）
3. 点 **Create new project**，等待约 1-2 分钟初始化完成。

## 第二步：建表（复制粘贴即可）

1. 左侧菜单 → **SQL Editor** → 点 **New query**。
2. 打开本目录的 `supabase_schema.sql`，**全选复制**其内容，粘贴进输入框。
3. 点 **Run**（或 Ctrl+Enter），显示 `Success` 即建表完成（表格名：`workspace_sync`）。

## 第三步：拿到两串"钥匙"

1. 左侧菜单 → **Project Settings**（齿轮）→ **API**。
2. 复制这两项：
   - **Project URL**：形如 `https://xxxxx.supabase.co`
   - **anon public key**：一串很长的 `eyJhbGci...` 开头的字符

## 第四步：在工作台里配置（每台设备都要做一次）

1. 打开工作台 <https://zhaorongfeng.github.io/Workbench/> → 左下 **⚙️ 设置** → **☁️ 配置云端同步**。
2. 依次填入：
   - **Supabase URL**：刚才的 Project URL（必须带 `https://`）
   - **anon key**：粘贴完整长串（不要多空格）
   - **同步码**：**自己定一个只有你知道的口令**（如 `2026shangan#go`），并把它记在安全的地方
3. 点 **保存并启用** → 再点 **测试连接**，看到 `✅ 连接成功` 即可。
4. 点 **手动上传**，把当前电脑上的数据推到云端。

## 第五步：其他设备接入

手机 / 平板打开同一网址 → 同样进入同步配置 → 填**完全相同**的 URL、key 和同步码 → 点 **手动下载**，云端数据就会合并到该设备。之后任何设备上的修改都会自动上传，其他设备刷新后即可看到。

---

## 常见问题

| 现象 | 原因 / 解决 |
|---|---|
| 测试连接失败 | URL 漏了 `https://`；anon key 复制不全；第二步的表没建成 |
| **上传报 `new row violates row-level security policy`** | 表的写入被 RLS 拦住。到 SQL Editor **重新完整运行一遍 `supabase_schema.sql`**（脚本会关闭 RLS 并授权 anon/authenticated），再回来上传 |
| 上传报 `permission denied for table workspace_sync` | 表缺少授权。运行脚本第 3 步的 `grant all on workspace_sync to anon, authenticated;` |
| 手机能连上但数据是空的/解不开 | **三台设备的同步码必须一字不差**（含大小写和符号） |
| 换了设备找不到配置 | 凭证只存在浏览器本地，重新填一次即可（不会泄露） |

> 💡 `supabase_schema.sql` 是**幂等**的，可以放心重复运行：不会重建表、不会清空已有数据，还能把 RLS / 授权 / 预置数据行一次性补齐。遇到任何云端写入报错，**先重跑一遍它**。

## 安全说明（为什么这样做是安全的）

- `anon key` 设计上就是**公开**的（相当于"这个项目允许匿名访问"的标识），放进前端不会泄密。
- 真正保护数据的是**同步码**：工作台在本地用同步码把数据加密后才存进云端，拿到 key 的人也只能看到乱码。
- 所以：**key 可以公开，同步码绝对不要告诉别人**。若怀疑同步码泄露，换一个新码并重新上传即可覆盖云端。
