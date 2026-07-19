#!/usr/bin/env python3
# 把「全球新闻选题日报」.md 渲染成 477汇报风格 HTML 页（极简白·苹果风·高密度列表）。
# 用法: python3 render-news-page.py <日报.md> [输出.html]
# 由 daily-news-radar.sh 每天自动调用，也可手动跑任意一天的日报。
import sys, re, os, html

def md_inline(s):
    s = html.escape(s)
    s = re.sub(r'\[([^\]]+)\]\((https?://[^)]+)\)', r'<a href="\2" target="_blank" rel="noopener">\1</a>', s)
    s = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
    return s

def badge(text):
    if '一手' in text or '🟢' in text: return '<span class="bdg g">一手</span>'
    if '待核验' in text or '⚠️' in text: return '<span class="bdg r">待核验</span>'
    if '二手' in text or '🟡' in text: return '<span class="bdg a">二手</span>'
    return ''

def parse(md):
    lines = md.split('\n')
    title, date = '全球新闻选题日报', ''
    if lines and lines[0].strip() == '---':
        end = lines[1:].index('---') + 1
        for l in lines[1:end]:
            if l.startswith('title:'): title = l.split(':',1)[1].strip()
            if l.startswith('date:'): date = l.split(':',1)[1].strip()
        lines = lines[end+1:]
    sections, cur2, cur3 = [], None, None
    for l in lines:
        if l.startswith('## '):
            cur2 = {'name': l[3:].strip(), 'h3': []}; sections.append(cur2); cur3 = None
        elif l.startswith('### ') and cur2 is not None:
            cur3 = {'name': l[4:].strip(), 'lines': []}; cur2['h3'].append(cur3)
        elif cur3 is not None:
            cur3['lines'].append(l)
    return title, date, sections

def clean_h3(name):
    # 去掉开头 emoji，单独拎出来
    m = re.match(r'\s*([\U0001F000-\U0001FAFF☀-➿]+)\s*(.*)', name)
    return (m.group(1), m.group(2)) if m else ('', name)

def news_rows(h3):
    rows = []
    for line in h3['lines']:
        if not line.strip().startswith('- '): continue
        body = line.strip()[2:]
        parts = re.split(r'\s+—\s+', body, maxsplit=1)
        main, src = parts[0], (parts[1] if len(parts) > 1 else '')
        bdg = badge(src)
        mt = re.match(r'\s*\*\*(.+?)\*\*[\.。:：]?\s*(.*)', main, re.S)
        ttl, desc = (mt.group(1), mt.group(2)) if mt else ('', main)
        src_clean = re.sub(r'[🟢🟡⚠️]|一手|二手|待核验', '', src).strip(' ·')
        rows.append(f'''<div class="row">
          <div class="r-top">{bdg}<span class="r-ttl">{md_inline(ttl)}</span></div>
          {f'<div class="r-desc">{md_inline(desc)}</div>' if desc.strip() else ''}
          {f'<div class="r-src">{md_inline(src_clean)}</div>' if src_clean else ''}
        </div>''')
    return rows

def topic_cards(h3, accent):
    out, cur = [], None
    for l in h3['lines']:
        m = re.match(r'\*\*(\d+)\.\s*(.+?)\*\*', l.strip())
        if m:
            if cur: out.append(cur)
            cur = {'n': m.group(1), 't': m.group(2), 'rows': []}
        elif l.strip().startswith('- ') and cur is not None:
            cur['rows'].append(l.strip()[2:])
    if cur: out.append(cur)
    cards = []
    for c in out:
        rows = ''
        for r in c['rows']:
            key, _, val = r.partition('：')
            if val:
                rows += f'<div class="tp-row"><span class="tp-k">{html.escape(key)}</span>{md_inline(val)}</div>'
            else:
                rows += f'<div class="tp-row">{md_inline(r)}</div>'
        cards.append(f'<div class="tcard {accent}"><div class="tc-h"><span class="tc-n">{c["n"]}</span>{md_inline(c["t"])}</div>{rows}</div>')
    return ''.join(cards) or f'<div class="muted">{md_inline(chr(10).join(h3["lines"]).strip())}</div>'

def build(md):
    title, date, sections = parse(md)
    navs, news_blocks, topic_blocks = [], [], []
    idx = 0
    for sec in sections:
        is_topic = '选题' in sec['name']
        for h3 in sec['h3']:
            idx += 1; aid = f's{idx}'
            emoji, label = clean_h3(h3['name'])
            if is_topic:
                navs.append(f'<a href="#{aid}" class="nav-link nt">{emoji} {html.escape(label)}</a>')
                accent = 'shulex' if 'Shulex' in h3['name'] else 'lazy'
                topic_blocks.append(f'<section id="{aid}" class="block"><h3 class="th"><span class="te">{emoji}</span>{html.escape(label)}</h3><div class="tgrid">{topic_cards(h3, accent)}</div></section>')
            else:
                rows = news_rows(h3)
                navs.append(f'<a href="#{aid}" class="nav-link">{emoji} {html.escape(label)}<span class="cnt">{len(rows)}</span></a>')
                inner = ''.join(rows) or '<div class="muted">今日无重要更新</div>'
                news_blocks.append(f'<section id="{aid}" class="panel"><div class="ph"><span class="pe">{emoji}</span>{html.escape(label)}<span class="pn">{len(rows)}</span></div>{inner}</section>')
    return PAGE.replace('{{TITLE}}', html.escape(title)).replace('{{DATE}}', html.escape(date)) \
        .replace('{{NAV}}', '\n'.join(navs)).replace('{{NEWS}}', '\n'.join(news_blocks)) \
        .replace('{{TOPICS}}', '\n'.join(topic_blocks))

PAGE = '''<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{TITLE}}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@500;600;700;800&display=swap" rel="stylesheet">
<style>
:root{--bg:#f5f5f7;--card:#fff;--primary:#0071e3;--ink:#1d1d1f;--ink2:#86868b;--ink3:#aeaeb2;--line:#eeeef0;
--g:#1a8a55;--gb:#eaf6ef;--a:#9a6a12;--ab:#fbf2e2;--r:#c8102e;--rb:#fcebee;
--sh:0 6px 24px rgba(0,0,0,.045);--sans:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,sans-serif;--outfit:'Outfit',var(--sans);}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased;font-size:15px}
a{color:var(--primary);text-decoration:none}a:hover{text-decoration:underline}
code{background:#f0f0f2;padding:1px 5px;border-radius:5px;font-size:.88em}
.wrap{max-width:1120px;margin:0 auto;padding:38px 26px;display:grid;grid-template-columns:212px 1fr;gap:30px}
/* sidebar */
.side{position:sticky;top:38px;align-self:start}
.brand{font-family:var(--outfit);font-weight:800;font-size:18px;letter-spacing:-.4px}
.brand .dot{color:var(--primary)}
.side .date{color:var(--ink2);font-size:12.5px;margin:3px 0 18px}
.nav-link{display:flex;align-items:center;gap:7px;padding:7px 11px;border-radius:10px;color:var(--ink);font-size:13px;font-weight:500;margin-bottom:2px}
.nav-link:hover{background:#fff;text-decoration:none;box-shadow:var(--sh)}
.nav-link .cnt{margin-left:auto;color:var(--ink3);font-size:11px;font-family:var(--outfit)}
.nav-link.nt{color:var(--primary);font-weight:600}
.navhead{font-family:var(--outfit);font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.6px;margin:16px 0 6px 11px}
.tip{margin-top:18px;background:#fff;border-radius:16px;padding:13px 15px;box-shadow:var(--sh);font-size:11.5px;color:var(--ink2);line-height:1.7}
.tip b{color:var(--ink);font-family:var(--outfit)}
/* hero */
.main{min-width:0}
.hero{margin-bottom:24px}
.hero h1{font-family:var(--outfit);font-weight:800;font-size:27px;letter-spacing:-.6px;line-height:1.15}
.hero .sub{color:var(--ink2);margin-top:7px;font-size:13.5px}
.group-h{font-family:var(--outfit);font-weight:700;font-size:13px;color:var(--ink2);text-transform:uppercase;letter-spacing:.8px;margin:6px 0 12px}
/* news panel = 一板块一面板，内部高密度行 */
.panel{background:var(--card);border-radius:18px;box-shadow:var(--sh);padding:6px 20px 10px;margin-bottom:16px;border:1px solid var(--line)}
.ph{display:flex;align-items:center;gap:8px;font-family:var(--outfit);font-weight:700;font-size:15px;padding:14px 0 10px;border-bottom:1px solid var(--line);margin-bottom:2px;letter-spacing:-.2px}
.ph .pe{font-size:16px}
.ph .pn{margin-left:auto;color:var(--ink3);font-size:12px;font-weight:600}
.row{padding:13px 0;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:none}
.r-top{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.r-ttl{font-weight:600;font-size:14.5px;line-height:1.45}
.r-desc{color:#48484a;font-size:13px;line-height:1.6;margin-top:5px}
.r-src{color:var(--ink3);font-size:11.5px;margin-top:6px}
.r-src a{color:var(--ink2)}
.bdg{font-family:var(--outfit);font-weight:600;font-size:10.5px;padding:1.5px 8px;border-radius:99px;white-space:nowrap;position:relative;top:-1px}
.bdg.g{background:var(--gb);color:var(--g)}
.bdg.a{background:var(--ab);color:var(--a)}
.bdg.r{background:var(--rb);color:var(--r)}
/* 选题区 = 高亮payoff */
.topics{margin-top:30px;padding-top:8px}
.block{margin-bottom:18px}
.th{font-family:var(--outfit);font-weight:700;font-size:15px;margin-bottom:11px;display:flex;align-items:center;gap:7px;letter-spacing:-.2px}
.th .te{font-size:16px}
.tgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.tcard{background:var(--card);border-radius:16px;box-shadow:var(--sh);padding:15px 17px;border:1px solid var(--line);border-top:3px solid var(--primary)}
.tcard.lazy{border-top-color:#34c759}
.tc-h{font-family:var(--outfit);font-weight:700;font-size:14px;line-height:1.4;margin-bottom:9px;display:flex;gap:8px}
.tc-n{flex:none;width:20px;height:20px;border-radius:7px;background:var(--primary);color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center}
.tcard.lazy .tc-n{background:#34c759}
.tp-row{font-size:12.5px;color:#48484a;line-height:1.55;padding:5px 0;border-top:1px solid var(--line)}
.tp-row:first-of-type{border-top:none;padding-top:2px}
.tp-k{font-family:var(--outfit);font-weight:600;color:var(--ink);background:#f3f3f5;padding:1px 7px;border-radius:6px;font-size:11px;margin-right:7px}
.muted{color:var(--ink2);font-size:13px;padding:8px 0}
.foot{color:var(--ink3);font-size:11.5px;margin-top:28px;text-align:center}
@media(max-width:820px){.wrap{grid-template-columns:1fr;padding:22px 15px}.side{position:static}.nav-link{display:inline-flex;margin:3px 4px 3px 0}.nav-link .cnt{display:none}.navhead{display:inline-block;margin:10px 8px 4px 0}.tgrid{grid-template-columns:1fr}}
</style></head><body>
<div class="wrap">
<aside class="side">
<div class="brand">新闻雷达<span class="dot">·</span>选题</div>
<div class="date">{{DATE}}</div>
{{NAV}}
<div class="tip"><b>每日 08:00 自动更新</b><br>抓一手全球新闻 → 结合 Shulex + 偷懒记 给选题。<br>🟢一手 · 🟡二手 · 🔴待核验需复核。</div>
</aside>
<main class="main">
<div class="hero"><h1>{{TITLE}}</h1><div class="sub">全球贸易 · 消费电子 · AI 科技 · 客服落地</div></div>
<div class="group-h">📰 今日全球新闻</div>
{{NEWS}}
<div class="topics"><div class="group-h">🎯 今日可用选题</div>{{TOPICS}}</div>
<div class="foot">此内容为 AI 生成，仅供参考；新闻数字以原文为准，标注待核验项请人工复核。</div>
</main>
</div></body></html>'''

if __name__ == '__main__':
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.splitext(src)[0] + '.html'
    md = open(src, encoding='utf-8').read()
    open(out, 'w', encoding='utf-8').write(build(md))
    print(out)
