# 部署「备考兔 · 上岸工作台」到公网

## 为什么部署到公网

部署后，**手机 / 平板 / 任意电脑**打开同一个公网网址即可使用；再配合工作台内的
「☁️ 云端同步（Supabase）」，就能实现多端数据实时同步。这样彻底摆脱：

- 固定局域网 IP（换电脑 / 换网络就访问不了）
- 手动导出导入 JSON 做迁移

PWA 已就绪（manifest + Service Worker），手机浏览器「加到主屏」后体验等同原生 App。

> ⚠️ 必须 **HTTPS** 才能安装 PWA / 注册 Service Worker。GitHub Pages 与 Netlify 都默认提供 HTTPS，
> 直接用它们即可，不要自己用 http 裸跑。

---

## 方式一：GitHub Pages（免费，推荐自动化）

1. 在 GitHub 新建仓库（如 `shangan`）。
2. **把本目录所有文件**（含 `.github/`）作为仓库根目录内容推送：
   ```
   git init
   git add .
   git commit -m "备考兔工作台"
   git branch -M main
   git remote add origin https://github.com/<用户名>/<仓库名>.git
   git push -u origin main
   ```
3. 仓库 → **Settings → Pages → Build and deployment → Source: GitHub Actions**。
   （本目录已内置 `.github/workflows/deploy.yml`，推送 `main` 会自动发布。）
4. 等待 Actions 跑完，访问 `https://<用户名>.github.io/<仓库名>/`。
5. 首次打开后：左下「设置」→「☁️ 配置云端同步」→ 填入 Supabase `URL` / `anon key` / `同步码`。

---

## 方式二：Netlify（免费，拖拽即用）

1. 本目录已内置 `netlify.toml`。
2. 打开 <https://app.netlify.com> → **Add new site → Deploy manually** → 拖拽本目录。
   或在 Netlify 选择 **Connect to Git** 连接本 GitHub 仓库。
3. 自动分配 `https://<随机名>.netlify.app`，可后续绑定自定义域名。
4. 同样在「设置 → 配置云端同步」里填入 Supabase 凭证。

---

## 使用与维护

- **凭证安全**：站点本身是纯前端，**不含任何密钥**；Supabase URL / anon key / 同步码只存在你
  本机浏览器的 `localStorage`。换设备时重新填一次即可，不会泄露给他人。
- **更新站点**：改完代码重新 `git push` 即更新（GitHub Pages）；Netlify 重新拖拽或开自动构建。
  Service Worker 缓存版本号当前为 `shangan-v2.1`，改动后旧缓存会被自动清理。
- **时政抓取**：`fetch_news.py` 是**本地运行**脚本（需 Python3），部署到网上后用不到。
  在你自己电脑上跑它生成 `politics_news.json`，再到工作台的「导入外部时政 JSON」上传即可。
- **Supabase 建表**：参考 `supabase_schema.sql`，在 Supabase 控制台 SQL Editor 运行一次。

---

## 常见坑

| 现象 | 原因 / 解决 |
|---|---|
| PWA 无法"加到主屏" | 必须用 **https** 访问；且首次需先正常打开一次页面让 SW 注册成功 |
| 打开是旧版 | Service Worker 缓存未刷新；浏览器强刷（Ctrl/Cmd+Shift+R）或清一次站点数据 |
| 同步提示"连接失败" | 检查 Supabase URL 是否带 `https://`、anon key 是否复制完整、表是否已建 |
| 数据是空/不对 | 多端填的 URL / key / **同步码必须完全一致**，否则解不开密文 |
