#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_news.py — 抓取时政 / 热点新闻，生成 politics_news.json，供「备考兔 · 上岸工作台」一键导入。

导入位置：申论/政治理论板块 → 「导入外部时政 JSON」。
输出格式：
    {
      "today": [ {"title": "...", "key": "...", "source": "..."}, ... ],   # 5 条
      "past":  [ {"title": "...", "key": "...", "source": "..."}, ... ]    # 5 条
    }

用法：
    python3 fetch_news.py                 # 抓取并写入 ./politics_news.json
    python3 fetch_news.py --out out.json  # 指定输出路径
    python3 fetch_news.py --count 5       # 每类条数（默认 5）
    python3 fetch_news.py --rss URL       # 额外追加一个 RSS 源（可多次）

依赖：仅标准库（urllib + xml）。可选：安装 requests 体验更好（脚本会自动使用）。
网络说明：脚本在你本机运行，需可访问外网；若全部源失败，会写出空数组并给出提示。
"""

import argparse
import json
import sys
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

# 候选热点聚合接口（按优先级尝试，第一个成功即采用）
JSON_SOURCES = [
    ("今日头条热榜", "https://api.vvhan.com/api/hotlist?type=toutiao", "vvhan"),
    ("微博热搜",     "https://api.vvhan.com/api/hotlist?type=weibo",   "vvhan"),
    ("百度热搜",     "https://api.vvhan.com/api/hotlist?type=baidu",   "vvhan"),
]

# 可选：官方时政 RSS（国情/人民网等，链接可能随站点调整；失败不影响其他源）
RSS_SOURCES = [
    "http://www.people.com.cn/rss/politics.xml",
]


def _http_get(url, timeout=10):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("utf-8", errors="ignore")


def _parse_vvhan(text):
    """解析 vvhan 热榜 JSON：data 为 [{title, url, hot}]"""
    data = json.loads(text)
    arr = data.get("data") or []
    items = []
    for it in arr:
        if isinstance(it, dict):
            title = (it.get("title") or it.get("word") or "").strip()
            hot = it.get("hot") or it.get("num") or ""
            url = it.get("url") or it.get("link") or ""
            if title:
                key = ("热度 " + str(hot)) if hot else ""
                items.append({"title": title, "key": key, "source": "热搜榜", "url": url})
    return items


def _parse_rss(text):
    items = []
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return items
    # 频道名作为来源
    src = (root.findtext("channel/title") or "").strip() or "RSS"
    # RSS 2.0
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = item.findtext("link") or ""
        desc = (item.findtext("description") or "").strip()
        site = item.findtext("{http://news.opensocial.org/}source") or src
        if title:
            items.append({"title": title, "key": _shorten(desc), "source": site, "url": link})
    # Atom
    if not items:
        ns = {"a": "http://www.w3.org/2005/Atom"}
        feed_title = (root.findtext("a:title") or "").strip() or src
        for entry in root.iter("{http://www.w3.org/2005/Atom}entry"):
            title = (entry.findtext("a:title") or "").strip()
            link_el = entry.find("a:link")
            link = link_el.get("href") if link_el is not None else ""
            summ = (entry.findtext("a:summary") or entry.findtext("a:content") or "").strip()
            if title:
                items.append({"title": title, "key": _shorten(summ), "source": feed_title, "url": link})
    return items


def _shorten(s, n=40):
    s = _strip_tags(s)
    return (s[:n] + "…") if len(s) > n else s


def _strip_tags(s):
    import re
    return re.sub(r"<[^>]+>", "", s or "").replace("\n", " ").strip()


def collect(count, extra_rss):
    items = []
    for name, url, kind in JSON_SOURCES:
        try:
            text = _http_get(url)
            got = _parse_vvhan(text) if kind == "vvhan" else []
            if got:
                print(f"✓ 来源可用：{name}（{len(got)} 条）")
                items += got
                if len(items) >= count * 2:
                    break
        except Exception as e:
            print(f"· 跳过 {name}：{e}")

    rss_list = list(RSS_SOURCES) + list(extra_rss or [])
    for url in rss_list:
        try:
            text = _http_get(url)
            got = _parse_rss(text)
            if got:
                print(f"✓ RSS 可用：{url}（{len(got)} 条）")
                items += got
        except Exception as e:
            print(f"· 跳过 RSS {url}：{e}")

    # 去重（按标题）
    seen, uniq = set(), []
    for it in items:
        t = it["title"]
        if t not in seen:
            seen.add(t)
            uniq.append(it)
    return uniq


def build(count):
    items = collect(count, [])
    today = items[:count]
    past = items[count:count * 2]
    # 兜底：不足则用占位提示（不填充假内容）
    warn = ""
    if len(items) < count:
        warn = "（抓取到的真实条目不足，今日/往期时政可能为空；请检查网络或更换源）"
    return {
        "today": today,
        "past": past,
        "_generated_at": datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M"),
        "_warning": warn,
    }


def main():
    ap = argparse.ArgumentParser(description="抓取时政热点 → politics_news.json")
    ap.add_argument("--out", default="politics_news.json", help="输出文件路径")
    ap.add_argument("--count", type=int, default=5, help="每个分类条数（默认 5）")
    ap.add_argument("--rss", action="append", default=[], help="追加 RSS 源 URL（可多次）")
    args = ap.parse_args()

    print("开始抓取时政/热点新闻 ...")
    data = build(args.count)

    # 去掉内部字段再写出（保留 _warning 仅作提示，可被前端忽略）
    out = {"today": data["today"], "past": data["past"]}
    if data["_warning"]:
        print("⚠️ " + data["_warning"])

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"✓ 已写入 {args.out}（today={len(out['today'])} 条, past={len(out['past'])} 条）")
    print("导入方式：工作台 → 政治理论/申论板块 → 「导入外部时政 JSON」→ 选择该文件")


if __name__ == "__main__":
    main()
