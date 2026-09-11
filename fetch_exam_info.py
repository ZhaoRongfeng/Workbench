#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_exam_info.py — 抓取考试公告 / 宣讲会信息，生成 exam_info.json，
供「备考兔 · 上岸工作台 → 考试汇总」一键导入。

依赖：仅 Python 3 标准库（urllib + html.parser + json + re）。

用法：
    python3 fetch_exam_info.py                 # 抓取并写入 ./exam_info.json
    python3 fetch_exam_info.py --out info.json # 指定输出路径
    python3 fetch_exam_info.py --pages 3       # 抓同济列表前 3 页（默认 2 页）

当前支持：
    · 同济大学学生就业指导中心「公务员 & 选调生」栏目（id=1014）
    · 几个固定公告页（上海选调、湖北选调、国考等，若页面不可访问则回退到预置信息）

说明：
    1. 本脚本在你本机运行，绕过浏览器 CORS 限制。
    2. 抓取到的 exam_info.json 可在工作台「考试汇总」→「导入 JSON」导入。
    3. 各地官网结构差异大，若某页解析失败会打印警告，不会中断。
"""

import argparse
import json
import re
import urllib.request
import urllib.parse
import urllib.error
from html.parser import HTMLParser
from datetime import datetime, timezone, timedelta

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

BASE_TJ = "https://tj91.tongji.edu.cn"

# 固定公告页（作为兜底/补充）
FIXED_SOURCES = [
    {
        "id": "info-shanghai-xuandiao-2026",
        "title": "2026上海市选调公告",
        "category": "上海",
        "subcategory": "选调",
        "url": "https://shacs.gov.cn/",
        "position_url": "https://shacs.gov.cn/",
    },
    {
        "id": "info-guokao-2026",
        "title": "2026年度国考公告",
        "category": "国考",
        "subcategory": "国考",
        "url": "http://www.scs.gov.cn/gkIndex.html",
        "position_url": "http://www.scs.gov.cn/gkIndex.html",
    },
    {
        "id": "info-hubei-xuandiao-2026",
        "title": "2026湖北省选调公告",
        "category": "湖北",
        "subcategory": "选调",
        "url": "http://www.hbsrsksy.cn/",
        "position_url": "http://www.hbsrsksy.cn/",
    },
    {
        "id": "info-henan-shengkao-2026",
        "title": "2026河南省考公告",
        "category": "河南",
        "subcategory": "省考",
        "url": "http://www.hnrsks.com/sitesources/hnsrskszx/page_pc/ksxxnew/index.html",
        "position_url": "http://www.hnrsks.com/sitesources/hnsrskszx/page_pc/ksxxnew/index.html",
    },
]

CAT_KEYWORDS = ['上海', '湖北', '河南', '北京', '广东', '浙江', '江苏', '山东', '四川', '辽宁',
                '安徽', '福建', '河北', '湖南', '陕西', '天津', '重庆', '江西', '云南', '贵州']

SUB_KEYWORDS = ['选调', '省考', '市考', '国考', '公务员', '事业单位', '宣讲会']

# 只保留该日期之后的公告（2026 下半年及以后的招录季，过滤上半年过期旧公告）
CUTOFF = "2026-07-01"

def _is_stale(item):
    """跳过汇总聚合卡与过期旧公告。"""
    title = item.get('title', '')
    if '汇总' in title:
        return True
    d = item.get('date', '')
    if d and d < CUTOFF:
        return True
    return False


class _Stripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
    def handle_data(self, data):
        self.parts.append(data)
    def get_text(self):
        return re.sub(r'\s+', ' ', ''.join(self.parts)).strip()


def strip_tags(html):
    s = _Stripper()
    try:
        s.feed(html or '')
    except Exception:
        pass
    return s.get_text()


def http_get(url, headers=None, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8', errors='ignore')


def http_post(url, data, headers=None, timeout=15):
    body = urllib.parse.urlencode(data).encode('utf-8')
    req = urllib.request.Request(url, data=body, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8', errors='ignore')


def get_tongji_token():
    try:
        res = json.loads(http_get(f"{BASE_TJ}/f/ajaxHome/getToken"))
        return res.get('data', '')
    except Exception as e:
        print(f"· 获取同济 token 失败：{e}")
        return ''


def infer_category(text):
    for kw in CAT_KEYWORDS:
        if kw in text:
            return kw
    if '国家公务员' in text or '国考' in text:
        return '国考'
    return '其他'


def infer_subcategory(text):
    for kw in SUB_KEYWORDS:
        if kw in text:
            return kw
    return '公告'


def parse_talk_blocks(text):
    """从「2027届选调生宣讲会汇总」类描述中解析多条宣讲会。"""
    blocks = []
    # 匹配：【辽宁省选调生宣讲会】时间：2026年9月16日，15:30地点：四平路校区...
    pattern = re.compile(r'【([^】]+)】\s*时间[：:]\s*([^地]+?)\s*地点[：:]\s*([^【\n]+?)(?=【|$)', re.S)
    for m in pattern.finditer(text):
        title = m.group(1).strip()
        time = m.group(2).strip()
        location = m.group(3).strip()
        blocks.append({"title": title, "time": time, "location": location})
    return blocks


def clean_text(t):
    return re.sub(r'\s+', ' ', t or '').strip()


def parse_tongji_list(token, category_id='1014', pages=2):
    items = []
    for page in range(1, pages + 1):
        try:
            raw = http_post(
                f"{BASE_TJ}/f/newsCenter/ajax_thisNewsAndSiblingCategoryList",
                {"categoryId": category_id, "pageNo": page, "pageSize": 10, "title": ""},
                headers={"token": token},
            )
            data = json.loads(raw)
            if data.get('state') != 1:
                print(f"· 同济列表第 {page} 页返回异常：{data.get('msg')}")
                continue
            rows = data.get('object', {}).get('newsPage', {}).get('list', [])
            for row in rows:
                title = clean_text(row.get('title', ''))
                desc = clean_text(row.get('description', ''))
                date = (row.get('releaseDate') or '')[:10]
                url = row.get('url', '')
                if url.startswith('/'):
                    url = BASE_TJ + url
                if not title or not url:
                    continue

                # 宣讲会汇总类：一条公告里包含多场宣讲
                if '汇总' in title and '【' in desc and '时间' in desc and '地点' in desc:
                    for talk in parse_talk_blocks(desc):
                        cat = infer_category(talk['title'])
                        items.append({
                            "id": f"info-tj-{row['id']}-{hash(talk['title']) & 0xFFFFFF}",
                            "title": f"{cat}选调宣讲会",
                            "category": cat,
                            "subcategory": "宣讲会",
                            "date": date,
                            "content": f"{talk['title']} 宣讲会信息。",
                            "links": [{"label": "同济原文", "url": url}],
                            "talk": talk,
                        })
                    continue

                # 普通条目
                cat = infer_category(title)
                sub = infer_subcategory(title)
                content = desc or f"{title}，来源：同济大学学生就业指导中心。"
                talk = None
                if '宣讲会' in title or ('时间' in desc and '地点' in desc):
                    blocks = parse_talk_blocks(desc)
                    if blocks:
                        talk = blocks[0]

                item = {
                    "id": f"info-tj-{row['id']}",
                    "title": title,
                    "category": cat,
                    "subcategory": sub,
                    "date": date,
                    "content": content,
                    "links": [{"label": "原文链接", "url": url}],
                }
                if talk:
                    item["talk"] = talk
                items.append(item)
        except Exception as e:
            print(f"· 抓取同济列表第 {page} 页失败：{e}")
    return items


def fetch_fixed_source(src):
    """尝试抓取固定公告页，失败则返回预置信息。"""
    url = src['url']
    try:
        html = http_get(url, timeout=10)
        # 取 <title>
        title_m = re.search(r'<title[^>]*>(.*?)</title>', html, re.S | re.I)
        title = clean_text(title_m.group(1)) if title_m else src['title']
        # 取 meta description
        desc_m = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)', html, re.S | re.I)
        desc = clean_text(desc_m.group(1)) if desc_m else ''
        if not desc:
            # 取第一个非空 <p>
            p_m = re.search(r'<p[^>]*>(.*?)</p>', html, re.S | re.I)
            desc = strip_tags(p_m.group(1)) if p_m else ''
        # 取日期
        date_m = re.search(r'(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日]?|\d{4}-\d{2}-\d{2})', html)
        date = date_m.group(1).replace('/', '-').replace('年', '-').replace('月', '-').replace('日', '') if date_m else ''
        # 尽量规范化成 YYYY-MM-DD
        try:
            date = datetime.strptime(date, '%Y-%m-%d').strftime('%Y-%m-%d')
        except Exception:
            pass
    except Exception as e:
        print(f"· 固定源抓取失败：{src['title']}（{e}），使用预置信息")
        title, desc, date = src['title'], '', ''

    links = [{"label": "公告原文", "url": src['url']}]
    if src.get('position_url') and src['position_url'] != src['url']:
        links.append({"label": "职位简章", "url": src['position_url']})

    return {
        "id": src['id'],
        "title": title,
        "category": src['category'],
        "subcategory": src['subcategory'],
        "date": date,
        "content": desc or f"{title}公告信息，详情请访问官网。",
        "links": links,
    }


def build(pages):
    result = []
    # 1) 固定公告页
    for src in FIXED_SOURCES:
        result.append(fetch_fixed_source(src))

    # 2) 同济大学就业网
    token = get_tongji_token()
    if token:
        tj_items = parse_tongji_list(token, pages=pages)
        print(f"✓ 同济就业网：抓取到 {len(tj_items)} 条")
        result.extend(tj_items)
    else:
        print("· 跳过同济就业网（未拿到 token）")

    # 去重（按 id）
    seen, uniq = set(), []
    for it in result:
        if it['id'] in seen:
            continue
        seen.add(it['id'])
        if _is_stale(it):
            print(f"· 跳过过期/聚合项：{it.get('title', it['id'])}")
            continue
        uniq.append(it)

    return {
        "_generated_at": datetime.now(timezone(timedelta(hours=8))).strftime('%Y-%m-%d %H:%M'),
        "_count": len(uniq),
        "items": uniq,
    }


def main():
    ap = argparse.ArgumentParser(description="抓取考试公告/宣讲会 → exam_info.json")
    ap.add_argument("--out", default="exam_info.json", help="输出文件路径")
    ap.add_argument("--pages", type=int, default=2, help="抓同济列表前 N 页（默认 2）")
    args = ap.parse_args()

    print("开始抓取考试信息 ...")
    data = build(args.pages)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(data["items"], f, ensure_ascii=False, indent=2)

    print(f"✓ 已写入 {args.out}（共 {data['_count']} 条）")
    print("导入方式：工作台 → 考试汇总 → 右上角「导入 JSON」→ 选择该文件")


if __name__ == "__main__":
    main()
