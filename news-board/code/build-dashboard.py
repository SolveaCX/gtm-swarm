#!/usr/bin/env python3
# 日报看板 v4：日历视图(今日亮点+5类标签+每日关键词) + 统一细体排版子页 + 加密账号模式(CryptoJS,http可用)。
# 输出自包含站点 选题雷达/site/(index.html + p/*.html + cj.js)，可本地开也可传 OSS news.skill101.cn。
import os, re, glob, html, calendar, datetime, sys
sys.path.insert(0, os.path.expanduser("~/.477-automation"))
import dash_crypto as C
PWFILE=os.path.expanduser("~/.477-automation/.dash-pass")
# 一行一个登录密码,都能看同一份内容(信封加密,谁都看不到别人密码)
PASSWORDS=[l.strip() for l in open(PWFILE,encoding='utf-8')] if os.path.exists(PWFILE) else ["CHANGEME"]
PASSWORDS=[p for p in PASSWORDS if p]
if not PASSWORDS: PASSWORDS=["CHANGEME"]
LOADER=open(os.path.expanduser("~/.477-automation/_loader_tpl.html"),encoding='utf-8').read()
# 信封:每个密码各包一份 MASTER(与页面内容无关,全站算一次)
WKEYS_JS="["+",".join('"'+C.wrap_master(pw)+'"' for pw in PASSWORDS)+"]"
VAULT = "/Users/siqiteng/Library/Mobile Documents/iCloud~md~obsidian/Documents/Obsidian/477知识中心"
SITE  = os.path.join(VAULT, "01_Projects/AI自媒体/选题雷达/site")
P     = os.path.join(SITE, "p")
os.makedirs(P, exist_ok=True)

# 各类日报;AI精读独立成页
SECTIONS = [
    {"key":"kehu",   "label":"跨境大卖","emoji":"🏢"},
    {"key":"news",   "label":"全球新闻","emoji":"🌍"},
    {"key":"kuaixun","label":"AI快讯",  "emoji":"⚡"},
    {"key":"zaobao", "label":"AI早报",  "emoji":"🌅"},
    {"key":"podcast","label":"AI播客",  "emoji":"🎧"},
    {"key":"blog",   "label":"AI博客",  "emoji":"📝"},
]
DAILY  = {"key":"daily", "label":"日报合集","emoji":"📚","cls":"t-daily"}
JINGDU = {"key":"jingdu","label":"AI精读",  "emoji":"📖","cls":"t-j"}
TYPES  = [DAILY, JINGDU]   # 日历chip/今日入口/统计/图例只分这2类
TLABEL = {t["key"]:t for t in TYPES}

def wrap(inner, title, cj="cj.js"):
    blob = C.encrypt_content(inner)
    return (LOADER.replace("{{TITLE}}", html.escape(title)).replace("{{SALT}}", C.SALT_JS)
                  .replace("{{CJ}}", cj).replace("{{WKEYS}}", WKEYS_JS).replace("{{BLOB}}", blob))

def md_inline(s):
    s = html.escape(s)
    s = re.sub(r'\[([^\]]+)\]\((https?://[^)]+)\)', r'<a href="\2" target="_blank" rel="noopener">\1</a>', s)
    s = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
    s = re.sub(r'!\[\[[^\]]+\]\]', '', s)
    s = re.sub(r'\[\[([^\]|]+)\|([^\]]+)\]\]', r'\2', s); s = re.sub(r'\[\[([^\]]+)\]\]', r'\1', s)
    return s

def md_to_html(md):
    md = re.sub(r'^---\n.*?\n---\n', '', md, count=1, flags=re.S)
    lines = md.split('\n'); out=[]; i=0
    inline = md_inline
    while i < len(lines):
        l = lines[i]
        if re.match(r'^\|.+\|', l) and i+1 < len(lines) and re.match(r'^\|[\s:|-]+\|', lines[i+1]):
            rows=[]
            while i < len(lines) and lines[i].strip().startswith('|'):
                rows.append([c.strip() for c in lines[i].strip().strip('|').split('|')]); i+=1
            t='<table><thead><tr>'+''.join(f'<th>{inline(c)}</th>' for c in rows[0])+'</tr></thead><tbody>'
            for r in rows[2:]: t+='<tr>'+''.join(f'<td>{inline(c)}</td>' for c in r)+'</tr>'
            out.append(t+'</tbody></table>'); continue
        m=re.match(r'^(#{1,4})\s+(.*?)(?:\s*\{#([\w-]+)\})?$', l)
        if m:
            hid=f' id="{m.group(3)}"' if m.group(3) else ''
            lvl=len(m.group(1)); txt=m.group(2)
            # 长复合标题按第一个" — "拆成 主题 + 灰色小字副题(播客/精读的90字标题手机上占5行,拆开好扫)
            if lvl>=3 and ' — ' in txt and len(txt)>36:
                main,sub=txt.split(' — ',1)
                out.append(f'<h{lvl}{hid}>{inline(main)}<span class="h-sub">{inline(sub)}</span></h{lvl}>'); i+=1; continue
            out.append(f'<h{lvl}{hid}>{inline(txt)}</h{lvl}>'); i+=1; continue
        if l.strip().startswith('> '):
            qt=l.strip()[2:]
            # 免责声明/编辑注记不配金句框,降级为小灰字
            if re.match(r'^(此内容为\s*AI|注[:：]|说明[:：]|抓源[:：])', qt.strip()):
                out.append(f'<p class="disclaimer">{inline(qt)}</p>'); i+=1; continue
            out.append(f'<blockquote>{inline(qt)}</blockquote>'); i+=1; continue
        if re.match(r'^[-*]\s+', l.strip()):
            items=[]
            while i<len(lines) and re.match(r'^[-*]\s+', lines[i].strip()):
                items.append(f'<li>{inline(re.sub(r"^[-*]\s+","",lines[i].strip()))}</li>'); i+=1
            out.append('<ul>'+''.join(items)+'</ul>'); continue
        mo=re.match(r'^(\d+)[.、]\s+(.*)', l.strip())
        if mo:
            # 每条编号各自成一个单item的ol(视觉与连续列表一致;好处:划词收藏的分段识别把每条当独立单元,不会一选全带走)
            out.append(f'<ol start="{mo.group(1)}"><li data-n="{mo.group(1)}">{inline(mo.group(2))}</li></ol>'); i+=1; continue
        if l.strip()=='': out.append(''); i+=1; continue
        if l.strip()=='---': out.append('<hr>'); i+=1; continue
        if re.match(r'^\*[^*]+\*$', l.strip()): out.append(f'<p class="disclaimer">{inline(l.strip().strip("*"))}</p>'); i+=1; continue
        out.append(f'<p>{inline(l)}</p>'); i+=1
    return '\n'.join(x for x in out if x)

# 细体·宽松排版(阅读不累)
REPORT_CSS='''
:root{--bg:#f7f4ee;--card:#fffdfa;--primary:#a8391f;--ink:#241f1a;--ink2:#8a7f72;--line:#ece6da;--sh:0 8px 28px rgba(60,40,20,.05);
--sans:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,sans-serif;--serif:'Noto Serif SC',Georgia,'Songti SC',serif;--outfit:'Outfit',var(--sans)}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:#3a342c;font-family:var(--sans);font-size:15.5px;line-height:1.85;font-weight:400;-webkit-font-smoothing:antialiased;letter-spacing:.1px}
.wrap{max-width:720px;margin:0 auto;padding:38px 22px 60px}
.back{display:inline-block;color:var(--ink2);font-size:13px;margin-bottom:16px;font-weight:400}
.sheet{background:var(--card);border-radius:20px;box-shadow:var(--sh);padding:40px 44px;border:1px solid var(--line)}
.tag{display:inline-block;font-family:var(--outfit);font-weight:600;font-size:11px;padding:3px 12px;border-radius:5px;margin-bottom:20px;background:#faeee9;color:var(--primary);letter-spacing:.4px;text-transform:uppercase}
.tag.t-daily{background:#fdf1e7;color:#a55c0d}.tag.t-j{background:#eef4ea;color:#1a8a55}
h1{font-family:var(--serif);font-weight:700;font-size:28px;letter-spacing:-.2px;line-height:1.4;margin-bottom:10px;color:var(--ink)}
h2{font-family:var(--serif);font-weight:700;font-size:21px;margin:38px 0 14px;padding:14px 0 0 14px;border-top:none;border-left:4px solid var(--primary);color:var(--ink);letter-spacing:0;scroll-margin-top:66px;background:linear-gradient(90deg,#faf3ec,transparent 70%);border-radius:4px}
h3{font-family:var(--serif);font-weight:600;font-size:16.5px;margin:24px 0 9px;padding-top:14px;border-top:1px solid var(--line);color:#2e2820;scroll-margin-top:66px}
h4{font-weight:500;font-size:14.5px;margin:14px 0 6px;color:#3a342c}
.h-sub{display:block;font-family:var(--sans);font-size:12.5px;font-weight:400;color:var(--ink2);margin-top:5px;line-height:1.6;font-style:normal}
.disclaimer{font-size:12px;color:var(--ink2);margin:10px 0;opacity:.85}
ol{margin:0;list-style:none;counter-reset:none}
ol li{padding:9px 0 9px 34px;position:relative;font-size:14.5px;color:#4a443b;border-bottom:1px solid var(--line);line-height:1.8}
ol li:before{content:attr(data-n);position:absolute;left:0;top:11px;width:22px;height:22px;border-radius:7px;background:#f0e8dc;color:#8a6a45;font-size:11.5px;font-weight:600;font-family:var(--outfit);display:flex;align-items:center;justify-content:center}
p{margin:12px 0;color:#4a443b;font-weight:400}
strong{font-weight:600;color:#241f1a}
a{color:var(--primary);text-decoration:none;font-weight:400;border-bottom:1px solid rgba(168,57,31,.25)}a:hover{border-bottom-color:var(--primary)}
ul{margin:10px 0;list-style:none}
li{padding:9px 0 9px 18px;position:relative;font-size:14.5px;color:#4a443b;border-bottom:1px solid var(--line);font-weight:400;line-height:1.8}
li:before{content:"";position:absolute;left:0;top:16px;width:5px;height:5px;border-radius:99px;background:#c9bfae}
li:last-child{border-bottom:none}
blockquote{border-left:3px solid var(--primary);background:transparent;padding:6px 0 6px 20px;color:#4a3f34;font-size:17px;margin:20px 0;font-weight:400;font-family:var(--serif);line-height:1.7;font-style:italic}
code{background:#f0ece2;padding:1px 6px;border-radius:6px;font-size:.9em;font-weight:400;font-family:ui-monospace,monospace}
table{width:100%;border-collapse:collapse;margin:14px 0;font-size:13.5px}
th{text-align:left;font-family:var(--outfit);font-weight:600;color:var(--ink2);padding:8px 10px;border-bottom:1px solid #e2dbcb}
td{padding:8px 10px;border-bottom:1px solid var(--line);color:#4a443b;font-weight:400}
hr{border:none;border-top:1px solid var(--line);margin:18px 0}
.pgnav{display:flex;justify-content:space-between;gap:12px;margin-top:32px;padding-top:20px;border-top:1px solid var(--line)}
.pgnav a,.pgnav span{flex:1;display:flex;flex-direction:column;padding:12px 16px;border-radius:12px;background:#fafafb;border:1px solid var(--line);font-size:13px;font-weight:500;color:var(--ink);text-decoration:none;transition:.15s;font-family:var(--outfit)}
.pgnav .pg-r{text-align:right;align-items:flex-end}
.pgnav a:hover{background:#fff;border-color:#d8d8dc;text-decoration:none;transform:translateY(-1px);box-shadow:var(--sh)}
.pgnav span span,.pgnav a span{font-size:11px;font-weight:400;color:var(--ink2);margin-top:3px}
.pg-disabled{opacity:.4;cursor:default}
.xt-link{position:fixed;top:18px;right:18px;background:#fff;border:1px solid var(--line);border-radius:99px;padding:7px 15px;font-size:12.5px;color:var(--primary);text-decoration:none;font-family:'Outfit',sans-serif;font-weight:500;z-index:100;box-shadow:0 4px 14px rgba(60,40,20,.06);transition:.15s}
.xt-link:hover{transform:translateY(-1px);text-decoration:none}
.xt-link span{background:#ff453a;color:#fff;border-radius:99px;padding:1px 7px;font-size:10.5px;margin-left:5px;font-weight:600}
.sec-nav a.sec-jump{background:#eef4ea;color:#147a4a}
.sec-nav a.sec-jump:hover{background:#147a4a;color:#fff}
#totop{position:fixed;right:18px;bottom:24px;width:42px;height:42px;border-radius:99px;background:#fff;border:1px solid var(--line);color:var(--ink2);font-size:17px;display:none;align-items:center;justify-content:center;cursor:pointer;z-index:200;box-shadow:0 6px 18px rgba(60,40,20,.1);text-decoration:none}
#totop:hover{color:var(--primary);border-color:var(--primary)}
.qd{background:#fff;border-radius:20px;box-shadow:var(--sh);border:1px solid var(--line);padding:18px 22px;margin:12px 0 4px}
.qd-h{font-family:var(--outfit);font-weight:600;font-size:14.5px;color:var(--ink2);margin-bottom:12px;letter-spacing:.2px}
.qd-grid{display:flex;flex-wrap:wrap;gap:8px}
.qd-chip{display:inline-flex;align-items:center;gap:6px;padding:9px 16px;border-radius:99px;text-decoration:none;color:var(--ink);font-family:var(--outfit);font-weight:500;font-size:13.5px;border:1px solid transparent;transition:.15s}
.qd-chip:hover{transform:translateY(-2px);box-shadow:var(--sh);text-decoration:none}
.qd-chip.t-daily{background:#fdf1e7;color:#a55c0d}
.qd-chip.t-j{background:#e6f4ec;color:#147a4a}
.hero{position:relative}
.sec-nav{position:sticky;top:0;z-index:20;display:flex;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;background:rgba(255,253,250,.94);backdrop-filter:blur(10px);padding:12px 0;margin:-8px 0 20px;border-bottom:1px solid var(--line)}
.sec-nav::-webkit-scrollbar{display:none}
.sec-nav a{display:inline-flex;align-items:center;gap:4px;padding:6px 13px;border-radius:99px;background:var(--bg);color:var(--ink2);text-decoration:none;font-size:12.5px;font-family:var(--outfit);font-weight:500;transition:.15s;white-space:nowrap;flex:none}
.sec-nav a:hover{background:var(--primary);color:#fff;text-decoration:none}
@media(max-width:640px){
  .sec-nav{top:0;padding:10px 0;gap:5px}
  .sec-nav a{padding:5px 11px;font-size:12px}
  .xt-link{position:static;display:inline-flex;align-items:center;margin-bottom:10px;font-size:12px}

  body{font-size:14.5px;line-height:1.75}
  .wrap{padding:22px 12px 50px}
  .sheet{padding:24px 18px;border-radius:18px}
  h1{font-size:21px}
  h2{font-size:17.5px;margin:28px 0 10px;padding:10px 0 0 10px}
  h3{font-size:15px;padding-top:10px}
  .h-sub{font-size:11.5px}
  li{font-size:14px;padding:8px 0 8px 16px;line-height:1.7}
  ol li{padding:8px 0 8px 30px}
  table{font-size:12.5px;display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}
  th{padding:6px 8px;white-space:nowrap}
  td{padding:6px 8px;white-space:normal;min-width:120px}
  blockquote{padding:8px 12px;font-size:13.5px}
  code{font-size:.85em}
}
'''

SHELL='''<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&family=Noto+Serif+SC:wght@400;600;700&display=swap" rel="stylesheet">
<style>{css}
#xt-btn{{position:fixed;display:none;z-index:9999;background:#a8391f;color:#fff;border:none;border-radius:99px;padding:8px 14px;font-size:13px;font-weight:500;font-family:'Outfit',sans-serif;box-shadow:0 6px 20px rgba(168,57,31,.35);cursor:pointer;animation:xfin .15s}}
#xt-btn:hover{{background:#8a2e18}}
@keyframes xfin{{from{{opacity:0;transform:translateY(4px)}}to{{opacity:1}}}}
#xt-toast{{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);background:rgba(29,29,31,.92);color:#fff;padding:11px 22px;border-radius:99px;font-size:13.5px;font-family:'Outfit',sans-serif;font-weight:500;z-index:9999;opacity:0;transition:opacity .2s;pointer-events:none;backdrop-filter:blur(10px)}}
#xt-toast.show{{opacity:1}}
</style></head><body><div class="wrap">
<a class="back" href="../index.html">← 回情报流</a>
<a class="xt-link" href="../选题清单.html">📌 选题清单<span id="xt-cnt">0</span></a>
<div class="sheet"><div class="tag {cls}">{tag}</div>{body}{nav}</div>
</div>
<button id="xt-btn">+ 加入选题</button>
<a id="totop" href="#" title="回到顶部">↑</a>
<div id="xt-toast"></div>
<script>
(function(){{
  function updCnt(){{var l=[];try{{l=JSON.parse(localStorage.getItem("xtlist")||"[]")}}catch(e){{}};l=l.filter(function(x){{return x&&!x.deleted;}});var e=document.getElementById("xt-cnt");if(e)e.textContent=l.length;}}
  updCnt();
  var sel="",btn=document.getElementById("xt-btn"),tst=document.getElementById("xt-toast");
  function hide(){{btn.style.display="none";}}
  function show(x,y){{btn.style.left=Math.max(10,Math.min(window.innerWidth-110,x-50))+"px";btn.style.top=Math.max(10,Math.min(window.innerHeight-50,y-44))+"px";btn.style.display="block";}}
  function toast(m){{tst.textContent=m;tst.classList.add("show");setTimeout(function(){{tst.classList.remove("show")}},1800);}}
  // 选段扩展到整段(li/p/blockquote)
  function isBoundary_(el){{if(!el)return false;var tag=el.tagName;if(/^(H1|H2|H3|H4|HR)$/i.test(tag))return true;if(tag==='UL'||tag==='OL')return el.children.length===1;if(tag==='P'){{var txt=el.textContent||'';if(/^[0-9]+[.、)）]\\s/.test(txt))return true;if(el.firstElementChild&&el.firstElementChild.tagName==='STRONG'&&el.firstChild===el.firstElementChild)return true;}}return false;}}
  function expandSeg(){{var s=window.getSelection();if(!s||!s.rangeCount)return "";var r=s.getRangeAt(0);var n=r.commonAncestorContainer;while(n&&n.nodeType===3)n=n.parentNode;
  // 多条列表(bullet间没空行的新闻小节)里,选哪条只取哪条;单条列表才走上下文扩展
  var li=n;while(li&&li.tagName!=='LI'&&li.parentElement)li=li.parentElement;
  if(li&&li.tagName==='LI'&&li.parentElement&&li.parentElement.children.length>1)return (li.innerText||li.textContent||'').trim();
  var blk=n;while(blk&&!/^(P|BLOCKQUOTE|H[1-4]|TD|UL|OL)$/i.test(blk.tagName)&&blk.parentElement)blk=blk.parentElement;if(!blk||!blk.parentElement)return s.toString().trim();var sibs=Array.from(blk.parentElement.children);var idx=sibs.indexOf(blk);if(idx<0)return (blk.innerText||blk.textContent||'').trim();var start=idx;if(!isBoundary_(sibs[start])){{while(start>0&&!isBoundary_(sibs[start-1]))start--;if(start>0&&isBoundary_(sibs[start-1])&&!/^HR$/i.test(sibs[start-1].tagName))start--;}}var end=idx;while(end+1<sibs.length&&!isBoundary_(sibs[end+1]))end++;var picked=sibs.slice(start,end+1).filter(function(x){{return !/^HR$/i.test(x.tagName);}});var text=picked.map(function(x){{return (x.innerText||x.textContent||'').trim();}}).filter(Boolean).join(String.fromCharCode(10,10));return text||(blk.innerText||blk.textContent||'').trim();}}
  function selText(){{return (window.getSelection()||"").toString().trim();}}
  var cachedFull="";
  // 选中的瞬间就把整段内容缓存下来——手机上点按钮时iOS会先清掉选区,不缓存的话expandSeg拿不到东西
  document.addEventListener("mouseup",function(e){{setTimeout(function(){{var t=selText();if(!t){{hide();return;}}sel=t;cachedFull=expandSeg()||t;show(e.clientX,e.clientY);}},10);}});
  document.addEventListener("touchend",function(e){{setTimeout(function(){{var t=selText();if(!t){{hide();return;}}sel=t;cachedFull=expandSeg()||t;var tch=(e.changedTouches&&e.changedTouches[0])||{{}};show(tch.clientX||100,tch.clientY||100);}},10);}});
  function killPop(){{var old=document.querySelectorAll("#xt-pop");for(var i=0;i<old.length;i++)old[i].remove();}}
  // 滚动超过阈值才收起按钮——手机选词后页面常有几十px的微滚,不该误杀
  var shownAtY=0;
  document.addEventListener("scroll",function(){{if(btn.style.display==="block"&&Math.abs(window.scrollY-shownAtY)>90){{hide();killPop();}}}},{{passive:true}});
  var _show0=show;show=function(x,y){{shownAtY=window.scrollY;_show0(x,y);}};
  btn.addEventListener("mousedown",function(e){{e.preventDefault();}});
  btn.addEventListener("touchstart",function(e){{e.preventDefault();e.stopPropagation();btn.click();}},{{passive:false}});
  // 账号列表
  function getAccts(){{var d=["偷懒记","Shulex","flatkey","其他"];try{{var v=JSON.parse(localStorage.getItem("xtaccts")||"null");if(v&&v.length)return v;}}catch(e){{}};localStorage.setItem("xtaccts",JSON.stringify(d));return d;}}
  function defAcct(){{return localStorage.getItem("xtdefacct")||getAccts()[0];}}
  // 点按钮 → 用整段 + 弹账号选
  btn.addEventListener("click",function(ev){{
    ev.stopPropagation();
    killPop();
    var full=cachedFull||expandSeg()||sel;if(full.length>1500)full=full.slice(0,1500);
    var pop=document.createElement("div");pop.id="xt-pop";pop.style.cssText="position:fixed;background:#fff;border:1px solid #eeeef0;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.12);padding:8px;z-index:10000;min-width:180px;font-family:'Outfit',sans-serif;font-weight:500;font-size:13.5px;animation:xfin .15s";
    var x=parseFloat(btn.style.left)||100,y=parseFloat(btn.style.top)||100;pop.style.left=Math.max(10,Math.min(window.innerWidth-200,x))+"px";pop.style.top=(y+40)+"px";
    pop.innerHTML='<div style="font-size:11px;color:#86868b;padding:4px 12px 6px;font-weight:400">收到哪个账号？(点旁边=存默认)</div>'+getAccts().map(function(a){{return '<div data-a="'+a.replace(/"/g,"&quot;")+'" style="padding:9px 14px;cursor:pointer;border-radius:9px;color:#1d1d1f">'+a+(a===defAcct()?' <span style="color:#a8391f;font-size:11px">·默认</span>':'')+'</div>';}}).join("");
    var saved=false;
    pop.addEventListener("click",function(e){{
      var a=e.target.closest("[data-a]");if(!a)return;
      var acct=a.getAttribute("data-a");localStorage.setItem("xtdefacct",acct);
      saved=true;saveOne(full,acct);pop.remove();
    }});
    document.body.appendChild(pop);
    // 点弹窗外面不再静默丢弃——直接存进默认账号(丢收藏比多存一条严重得多,多的可以去清单里删)
    setTimeout(function(){{document.addEventListener("click",function rm(ev){{if(!pop.contains(ev.target)){{if(!saved&&document.body.contains(pop)){{saved=true;saveOne(full,defAcct());}}pop.remove();document.removeEventListener("click",rm);}}}});}},50);
    hide();
  }});
  function xtSync(l){{
    // 推云端前先拉远端合并(两台设备先后收藏时,后写的不再把先写的顶掉)
    var _pw=document.cookie.match(/dpw=([^;]+)/);
    if(!_pw||typeof CryptoJS==="undefined")return;
    var _s=CryptoJS.lib.WordArray.create(new Uint8Array([55,65,122,91,17,200,157,46,100,240,163,25,136,92,215,66]));
    var h=CryptoJS.PBKDF2(decodeURIComponent(_pw[1]),_s,{{keySize:4,iterations:10000,hasher:CryptoJS.algo.SHA256}}).toString();
    var url="http://skill101-news.oss-cn-hangzhou.aliyuncs.com/xtsync/"+h+".json";
    fetch(url+"?_t="+Date.now(),{{cache:"no-store"}}).then(function(r){{return r.ok?r.json():[];}}).catch(function(){{return [];}}).then(function(remote){{
      var seen={{}},merged=[];
      (l||[]).concat(Array.isArray(remote)?remote:[]).forEach(function(it){{
        var k=it.id||((it.ts||0)+"|"+(it.text||"").slice(0,40));
        if(!seen[k]){{seen[k]=true;merged.push(it);}}
      }});
      merged.sort(function(a,b){{return (b.ts||0)-(a.ts||0);}});
      localStorage.setItem("xtlist",JSON.stringify(merged.filter(function(x){{return !x.deleted;}})));
      updCnt();
      fetch(url,{{method:"PUT",headers:{{"Content-Type":"application/json"}},body:JSON.stringify(merged)}}).catch(function(){{}});
    }});
  }}
  function saveOne(full,acct){{
    var frag="";try{{var enc=encodeURIComponent(full.slice(0,80));frag="#:~:text="+enc;}}catch(e){{}};
    var l=[];try{{l=JSON.parse(localStorage.getItem("xtlist")||"[]")}}catch(e){{}};
    l.unshift({{id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),text:full,src:document.title,url:location.pathname.split("/").pop(),fragment:frag,account:acct,tags:[],note:"",ts:Date.now()}});
    localStorage.setItem("xtlist",JSON.stringify(l));
    updCnt();toast("✓ 已加入「"+acct+"」· 共 "+l.filter(function(x){{return !x.deleted;}}).length+" 条");
    if(window.getSelection)window.getSelection().removeAllRanges();
    xtSync(l);
  }}
  // 回到顶部(滚超2屏才出现)
  var tt=document.getElementById("totop");
  if(tt){{
    tt.addEventListener("click",function(e){{e.preventDefault();window.scrollTo({{top:0,behavior:"smooth"}});}});
    document.addEventListener("scroll",function(){{tt.style.display=window.scrollY>window.innerHeight*2?"flex":"none";}},{{passive:true}});
  }}
}})();
</script>
</body>'''

def write_page(fn, title, cls, tag, md, prev_fn=None, prev_d=None, next_fn=None, next_d=None, toc=""):
    nav=""
    if prev_fn or next_fn:
        left=(f'<a class="pg-l" href="{prev_fn}">← 上一天<span>{prev_d}</span></a>' if prev_fn else '<span class="pg-disabled">← 上一天</span>')
        right=(f'<a class="pg-r" href="{next_fn}">下一天 →<span>{next_d}</span></a>' if next_fn else '<span class="pg-disabled">下一天 →</span>')
        nav=f'<div class="pgnav">{left}{right}</div>'
    body_html = md_to_html(md)
    h1_html = '' if '<h1' in body_html else f'<h1>{html.escape(title)}</h1>'
    body_html = h1_html + toc + body_html
    inner = SHELL.format(title=html.escape(title),css=REPORT_CSS,cls=cls,tag=html.escape(tag),body=body_html,nav=nav)
    open(os.path.join(P,fn),'w',encoding='utf-8').write(wrap(inner, title, "../cj.js"))

STOP={'今日','本周','一个','这个','已经','可能','以及','还是','以为','一手','二手','待核验','全球','最新','正式','宣布','发布','推出','一句话','要点','一句话要点','给','对','结合点','选题','标题','背景','来源','链接','日记体钩子','选题角度','赋能创作'}
def extract_kw(md):
    kws=[]
    for m in re.finditer(r'\*\*(.+?)\*\*', md):
        t=re.split(r'[\s（(:：,，。.、\-—→/|]', m.group(1).strip())[0]
        t=re.sub(r'[^\u4e00-\u9fa5A-Za-z0-9.\-]','',t).strip('.-')   # 去emoji/符号,只留中英数
        if re.match(r'^\d', t): continue                            # 数字开头(日期/金额)不当关键词
        if re.search(r'\d+[年月日亿万]', t): continue                  # 含日期/金额片段的不要
        if 2<=len(t)<=10 and re.search(r'[\u4e00-\u9fa5A-Za-z]',t) and t not in kws and t not in STOP and not t.isdigit():
            kws.append(t)
        if len(kws)>=8: break
    return kws

def highlights(news_md):
    titles=[]
    for m in re.finditer(r'^- \*\*(.+?)\*\*', news_md, re.M):
        t=re.sub(r'\s*[（(].*$','',m.group(1)).strip()
        if t and t not in titles: titles.append(t)
        if len(titles)>=5: break
    return titles

def strip_title(md):
    """去掉frontmatter + 紧跟着的顶级# 标题行(拼进合集时不需要重复标题) + 各板块的元信息噪音行 + 标题整体降一级"""
    md = re.sub(r'^---\n.*?\n---\n', '', md, count=1, flags=re.S).lstrip('\n')
    lines = md.split('\n')
    if lines and re.match(r'^#\s+', lines[0]):
        lines = lines[1:]
    # 拼合集时去噪:抓取窗口/AI生成声明/下期见——单板块页面有用,合并页里重复5遍是噪音(合集页统一在尾部加一条声明)
    noise = re.compile(r'^(>?\s*)?(抓取窗口|此内容为\s*AI\s*生成|>\s*此内容为|抓源[:：]|\*下期早报见)')
    lines = [l for l in lines if not noise.search(l.strip())]
    # 丢掉与板块名重复的开头二级标题(如"## 📰 全球新闻日报"/"## 🎧 AI 播客推荐"——板块标题已经说了一遍)
    for j,l in enumerate(lines):
        if not l.strip(): continue
        if re.match(r'^##\s+', l) and re.search(r'(全球新闻|播客|快讯|早报|博客)', l):
            lines = lines[:j] + lines[j+1:]
        break
    # 子文档标题整体降一级(##→###,###→####),让板块大标题(h2)独占一层,长页里板块边界清晰
    lines = [re.sub(r'^(#{2,3})(\s)', r'#\1\2', l) for l in lines]
    return '\n'.join(lines).strip()

def scan():
    days={}; daykw={}
    sec={s["key"]:{} for s in SECTIONS}   # key -> {date: raw_md}
    jingdu_items=[]                        # [(date,title,cls,tag,md)]
    def kw(d,text):
        cur=daykw.setdefault(d,[])
        for w in extract_kw(text):
            if w not in cur and len(cur)<4: cur.append(w)
    latest=("","")
    for f in sorted(glob.glob(os.path.join(VAULT,"01_Projects/AI自媒体/选题雷达/*_全球新闻选题日报.md"))):
        m=re.search(r'(\d{4}-\d{2}-\d{2})',os.path.basename(f))
        if not m: continue
        d=m.group(1); md=open(f,encoding='utf-8').read()
        sec["news"][d]=md
        if d>=latest[0]: latest=(d,md)
        kw(d,md)
    for f in glob.glob(os.path.join(VAULT,"01_Projects/AI自媒体/选题雷达/*_AI博客日报.md")):
        m=re.search(r'(\d{4}-\d{2}-\d{2})',os.path.basename(f))
        if not m: continue
        d=m.group(1); md=open(f,encoding='utf-8').read()
        sec["blog"][d]=md; kw(d,md)
    # Shulex 客户新闻 / 目标客户新闻(扫名单近况)
    for f in glob.glob(os.path.join(VAULT,"01_Projects/AI自媒体/选题雷达/*_Shulex客户新闻.md")):
        m=re.search(r'(\d{4}-\d{2}-\d{2})',os.path.basename(f))
        if m: sec["kehu"][m.group(1)]=open(f,encoding='utf-8').read()
    # AI播客:命名约定 <date>_AI播客.md(00_Inbox 或归档后的 04_Archive)
    for f in glob.glob(os.path.join(VAULT,"00_Inbox/*_AI播客.md"))+glob.glob(os.path.join(VAULT,"04_Archive/*/*_AI播客.md")):
        m=re.match(r'(\d{4}-\d{2}-\d{2})_AI播客',os.path.basename(f))
        if not m: continue
        d=m.group(1); md=open(f,encoding='utf-8').read()
        sec["podcast"][d]=md; kw(d,md)
    kindmap={"早报":"zaobao","快讯":"kuaixun"}
    for f in glob.glob(os.path.join(VAULT,"04_Archive/*/*_AI*.md"))+glob.glob(os.path.join(VAULT,"00_Inbox/*_AI*.md")):
        m=re.match(r'(\d{4}-\d{2}-\d{2})_AI(早报|快讯|精读)',os.path.basename(f))
        if not m: continue
        d,kind=m.group(1),m.group(2); md=open(f,encoding='utf-8').read()
        if kind=="精读":
            jingdu_items.append((d,f"{d} AI精读",JINGDU["cls"],f'{JINGDU["emoji"]} {JINGDU["label"]}',md))
        else:
            sec[kindmap[kind]][d]=md
        if d not in daykw or not daykw[d]: kw(d,md)

    # ① 日报合集(5类合并,按板块分区,一个页面滑到底) + 按天翻页
    all_dates = sorted(set().union(*[set(v.keys()) for v in sec.values()])) if any(sec.values()) else []
    jd_dates = {x[0] for x in jingdu_items}
    for i,d in enumerate(all_dates):
        present=[s for s in SECTIONS if d in sec[s["key"]]]
        parts=[]
        for s in present:
            body = strip_title(sec[s["key"]][d])
            if s["key"]=="news":
                # 给"今日选题推荐"(全站最有行动价值的部分)加直达锚点
                body = body.replace('### 🎯 今日选题推荐', '### 🎯 今日选题推荐 {#sec-xuanti}', 1)
            parts.append(f'## {s["emoji"]} {s["label"]} {{#sec-{s["key"]}}}\n\n{body}')
        combined_md = "\n\n---\n\n".join(parts) + "\n\n---\n\n> 此内容为 AI 生成，仅供参考；新闻数字以原文为准。"
        toc_items = [f'<a href="#sec-{s["key"]}">{s["emoji"]} {s["label"]}</a>' for s in present]
        if "news" in [s["key"] for s in present]:
            toc_items.insert(1, '<a href="#sec-xuanti">🎯 选题推荐</a>')
        if d in jd_dates:
            toc_items.append(f'<a class="sec-jump" href="{d}_jingdu.html">📖 当天精读 →</a>')
        toc_html = ('<nav class="sec-nav">'+''.join(toc_items)+'</nav>') if len(toc_items)>1 else ''
        fn=f"{d}_daily.html"
        prev_d=all_dates[i-1] if i>0 else None
        next_d=all_dates[i+1] if i<len(all_dates)-1 else None
        write_page(fn, f"{d} 日报合集", DAILY["cls"], f'{DAILY["emoji"]} {DAILY["label"]}', combined_md, toc=toc_html,
                   prev_fn=f"{prev_d}_daily.html" if prev_d else None, prev_d=prev_d,
                   next_fn=f"{next_d}_daily.html" if next_d else None, next_d=next_d)
        days.setdefault(d,{})["daily"]=fn

    # ② AI精读独立成页 + 按天翻页(逻辑不变) + 回当天合集的互跳
    jingdu_items.sort(key=lambda x:x[0])
    for i,(d,title,cls,tag,md) in enumerate(jingdu_items):
        fn=f"{d}_jingdu.html"
        prev=jingdu_items[i-1] if i>0 else None
        nxt=jingdu_items[i+1] if i<len(jingdu_items)-1 else None
        toc = f'<nav class="sec-nav"><a class="sec-jump" href="{d}_daily.html">📚 当天日报合集 →</a></nav>' if d in days and "daily" in days[d] else ''
        write_page(fn,title,cls,tag,md, toc=toc,
                   prev_fn=f"{prev[0]}_jingdu.html" if prev else None, prev_d=prev[0] if prev else None,
                   next_fn=f"{nxt[0]}_jingdu.html" if nxt else None,    next_d=nxt[0] if nxt else None)
        days.setdefault(d,{})["jingdu"]=fn
    return days, daykw, latest, sec, jingdu_items

# ============ 信息流:把各类日报拆成单条卡片 ============
def _strip_fm(md):
    return re.sub(r'^---\n.*?\n---\n', '', md, count=1, flags=re.S)

def parse_news(md):
    """全球新闻:每条bullet一卡(- **标题** — 内容)"""
    items=[]
    body_part = md.split('## 🎯')[0]
    for m in re.finditer(r'^-\s+\*\*(.+?)\*\*\s*(?:—|-|——)?\s*(.*)$', _strip_fm(body_part), re.M):
        items.append({"t":m.group(1).strip(),"b":[m.group(2).strip()],"extra":None})
    return items

def parse_kuaixun(md):
    """AI快讯:### N. 标题 分块;🔗行并入来源;📌赋能创作折叠;块内容遇到下一个##二级标题即截断(防尾部速览表/选题段漏灌)"""
    items=[]
    blocks = re.split(r'^###\s+', _strip_fm(md), flags=re.M)[1:]
    for blk in blocks:
        lines = blk.split('\n')
        title = re.sub(r'^\d+[.、]\s*', '', lines[0].strip())
        body=[]; extra=None
        for l in lines[1:]:
            ls=l.strip()
            if re.match(r'^##\s', ls): break          # 撞到新的二级标题=本条快讯结束
            if not ls or ls=='---': continue
            if re.match(r'^\|', ls): continue          # 表格行不进卡片(卡片按段落渲染,表格会漏原始markdown)
            if ls.startswith('📌'): extra=re.sub(r'^📌\s*(赋能创作|对\s*Shulex\s*的意义)?\s*[:：]?\s*','',ls)
            else: body.append(ls)
        items.append({"t":title,"b":body,"extra":extra})
    return items

def parse_xuanti(news_md):
    """从全球新闻文件提取'今日选题推荐',按账号拆成卡片(一个账号一张卡,含完整推荐内容)"""
    m = re.search(r'##\s*🎯\s*今日选题推荐(.*?)(?=^##\s|\Z)', _strip_fm(news_md), re.S|re.M)
    if not m: return []
    items=[]
    for am in re.split(r'^###\s+', m.group(1), flags=re.M)[1:]:
        lines=am.split('\n')
        acct=lines[0].strip()
        body=[]
        for l in lines[1:]:
            ls=l.strip()
            if re.match(r'^##', ls): break
            if not ls or ls=='---': continue
            if re.match(r'^\|', ls): continue
            body.append(re.sub(r'^[-*]\s+','',ls))
        if body: items.append({"t":f"🎯 {acct}","b":body,"extra":None})
    return items

def parse_zaobao(md):
    """AI早报:**标题**行+紧跟正文=一卡;数据看点合成一卡"""
    items=[]
    txt=_strip_fm(md); lines=txt.split('\n'); i=0
    while i<len(lines):
        l=lines[i].strip()
        if re.match(r'^##\s*📊', l):
            bullets=[]
            i+=1
            while i<len(lines) and not lines[i].strip().startswith('##'):
                if lines[i].strip().startswith('- '): bullets.append(lines[i].strip()[2:])
                i+=1
            if bullets: items.append({"t":"📊 数据看点","b":bullets,"extra":None})
            continue
        m=re.match(r'^\*\*(.+)\*\*$', l)
        if m:
            body=[]
            i+=1
            while i<len(lines) and lines[i].strip() and not re.match(r'^(\*\*|##|---|\|)', lines[i].strip()):
                body.append(lines[i].strip()); i+=1
            items.append({"t":m.group(1),"b":body,"extra":None})
            continue
        i+=1
    return items

def parse_blog(md):
    """AI博客:编号行每条一卡,标题取粗体或截断"""
    items=[]
    body_part = _strip_fm(md).split('## 🔑')[0]
    for m in re.finditer(r'^\d+[.、]\s+(.*)$', body_part, re.M):
        c=m.group(1).strip()
        tm=re.search(r'\*\*(.+?)\*\*', c)
        title = tm.group(1) if tm else (re.sub(r'\[.*?\]\(.*?\)','',c)[:32]+"…")
        items.append({"t":title,"b":[c],"extra":None})
    return items

def parse_podcast(md):
    txt=_strip_fm(md)
    tm=re.search(r'^###\s+(.+)$', txt, re.M)
    ym=re.search(r'\*\*一句话要点\*\*[:：]\s*(.*)', txt)
    qm=re.search(r'^>\s*[「"](.+?)[」"]', txt, re.M)
    im=re.search(r'\*\*对477的启发\*\*[:：]\s*(.*)', txt)
    lk=re.findall(r'\[👉[^\]]*\]\((https?://[^)]+)\)', txt)
    if not tm: return []
    body=[ym.group(1)] if ym else []
    if qm: body.append('「'+qm.group(1)+'」')
    if lk: body.append(' · '.join(f'[👉 收听/阅读]({u})' for u in lk[:2]))
    return [{"t":tm.group(1).strip(),"b":body,"extra":im.group(1) if im else None}]

def parse_jingdu(md):
    txt=_strip_fm(md)
    tm=re.search(r'^###\s+(.+)$', txt, re.M)
    ym=re.search(r'\*\*一句话要点\*\*[:：]\s*(.*)', txt)
    if not tm: return []
    return [{"t":tm.group(1).strip(),"b":[ym.group(1)] if ym else [],"extra":None}]

FEED_TYPES=[
    {"key":"xuanti","label":"选题推荐","emoji":"🎯","color":"#a8391f"},
    {"key":"kehu","label":"跨境大卖","emoji":"🏢","color":"#0f7a6b"},
    {"key":"kuaixun","label":"AI快讯","emoji":"⚡","color":"#c98a1b"},
    {"key":"news","label":"全球新闻","emoji":"🌍","color":"#2f6db3"},
    {"key":"zaobao","label":"AI早报","emoji":"🌅","color":"#d0603a"},
    {"key":"podcast","label":"AI播客","emoji":"🎧","color":"#7a5bbf"},
    {"key":"blog","label":"AI博客","emoji":"📝","color":"#3f8f5f"},
    {"key":"jingdu","label":"AI精读","emoji":"📖","color":"#147a4a"},
]
FT={t["key"]:t for t in FEED_TYPES}
PARSERS={"news":parse_news,"kuaixun":parse_kuaixun,"zaobao":parse_zaobao,"blog":parse_blog,"podcast":parse_podcast,"kehu":parse_kuaixun}
# 折叠区标题:客户/目标客户类的📌是"对Shulex的意义",其余是"创作角度"
FOLD_LABEL={"kehu":"💡 对 Shulex 的用法"}

def feed_card(key,it,url,src,golink=None,cid=""):
    ft=FT[key]
    body="".join(f'<p>{md_inline(b)}</p>' for b in it["b"] if b)
    extra=f'<details class="idea"><summary>{FOLD_LABEL.get(key,"💡 创作角度")}</summary><p>{md_inline(it["extra"])}</p></details>' if it.get("extra") else ''
    go=f'<a class="fc-go" href="p/{golink}">读全文 →</a>' if golink else ''
    return (f'<article class="fc" data-f="{key}" data-cid="{html.escape(cid)}" data-url="{url}" data-src="{html.escape(src)}">'
            f'<div class="fc-top"><span class="fb" style="background:{ft["color"]}18;color:{ft["color"]}">{ft["emoji"]} {ft["label"]}</span>'
            f'<span class="fc-act"><button class="fpin" title="钉住/取消钉住">📌</button><button class="fx" title="标记已读,收进归档">✕</button></span></div>'
            f'<h3 class="fc-t">{md_inline(it["t"])}</h3>'
            f'<div class="fc-b">{body}</div>{extra}{go}</article>')

def feed_html(sec, jingdu_items, days, daykw):
    import datetime as _dt
    today=_dt.date.today()
    all_dates=sorted(set().union(*[set(v.keys()) for v in sec.values()], {x[0] for x in jingdu_items}), reverse=True) if (any(sec.values()) or jingdu_items) else []
    show_dates=all_dates[:5]
    jd_map={x[0]:x[4] for x in jingdu_items}
    wd=["周一","周二","周三","周四","周五","周六","周日"]
    day_secs=[]; type_count={t["key"]:0 for t in FEED_TYPES}
    for d in show_dates:
        cards=[]
        durl=f"{d}_daily.html"; dsrc=f"{d} 日报合集"
        # 顺序:选题推荐→Shulex客户→目标客户→快讯→全球新闻→早报→播客→博客→精读
        def _cid(key,it): return f"{d}|{key}|{it['t'][:40]}"
        if d in sec.get("news",{}):
            for it in parse_xuanti(sec["news"][d]):
                cards.append(feed_card("xuanti",it,durl,dsrc,cid=_cid("xuanti",it))); type_count["xuanti"]+=1
        for key in ["kehu","kuaixun","news","zaobao","podcast","blog"]:
            if d in sec.get(key,{}):
                for it in PARSERS[key](sec[key][d]):
                    cards.append(feed_card(key,it,durl,dsrc,cid=_cid(key,it))); type_count[key]+=1
        if d in jd_map:
            for it in parse_jingdu(jd_map[d]):
                cards.append(feed_card("jingdu",it,f"{d}_jingdu.html",f"{d} AI精读",golink=f"{d}_jingdu.html",cid=_cid("jingdu",it))); type_count["jingdu"]+=1
        if not cards: continue
        dd=_dt.date.fromisoformat(d); diff=(today-dd).days
        label = "今天" if diff==0 else ("昨天" if diff==1 else ("前天" if diff==2 else d[5:]))
        day_secs.append(f'<section class="fday"><h2 class="fday-h"><span>{label}</span><span class="fday-d">{d} {wd[dd.weekday()]}</span></h2><div class="cards">{"".join(cards)}</div></section>')
    chips='<button class="fchip on" data-f="all">全部</button>'+''.join(
        f'<button class="fchip" data-f="{t["key"]}" style="--c:{t["color"]}">{t["emoji"]} {t["label"]} <i>{type_count[t["key"]]}</i></button>'
        for t in FEED_TYPES if type_count[t["key"]]>0)
    # 近期热词
    allkw={}
    for d in sorted(daykw)[-14:]:
        for w in daykw[d]: allkw[w]=allkw.get(w,0)+1
    hot=sorted(allkw, key=lambda w:-allkw[w])[:12]
    hot_html=('<div class="hot"><span class="hot-l">近期热词</span>'+''.join(f'<span class="ht">{html.escape(w)}</span>' for w in hot)+'</div>') if hot else ''
    stat=" · ".join(f'{t["emoji"]}{t["label"]} {sum(1 for v in days.values() if t["key"] in v)}' for t in TYPES)
    return (FEED.replace("{{CHIPS}}",chips).replace("{{FEED}}","\n".join(day_secs))
                .replace("{{HOT}}",hot_html).replace("{{STAT}}",html.escape(stat)))

FEED='''<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI 情报流</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&family=Noto+Serif+SC:wght@600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#f7f4ee;--card:#fffdfa;--primary:#a8391f;--ink:#241f1a;--ink2:#8a7f72;--ink3:#b8ab98;--line:#ece6da;--sh:0 8px 26px rgba(60,40,20,.05);
--sans:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,sans-serif;--serif:'Noto Serif SC',Georgia,'Songti SC',serif;--outfit:'Outfit',var(--sans)}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:#3a342c;font-family:var(--sans);font-size:15px;line-height:1.75;font-weight:400;-webkit-font-smoothing:antialiased}
.wrap{max-width:760px;margin:0 auto;padding:34px 20px 60px}
.hero h1{font-family:var(--serif);font-weight:700;font-size:27px;letter-spacing:-.2px;color:var(--ink)}
.hero .sub{color:var(--ink2);margin-top:7px;font-size:13px}
.hero .sub a{color:var(--primary);text-decoration:none;font-weight:500}
.xt-link{position:fixed;top:18px;right:18px;background:#fff;border:1px solid var(--line);border-radius:99px;padding:7px 15px;font-size:12.5px;color:var(--primary);text-decoration:none;font-family:var(--outfit);font-weight:500;z-index:100;box-shadow:0 4px 14px rgba(60,40,20,.06);transition:.15s}
.xt-link:hover{transform:translateY(-1px);text-decoration:none}
.xt-link span{background:#ff453a;color:#fff;border-radius:99px;padding:1px 7px;font-size:10.5px;margin-left:5px;font-weight:600}
.hot{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:14px 0 2px}
.hot-l{font-family:var(--outfit);font-size:11px;font-weight:600;color:var(--ink3);text-transform:uppercase;letter-spacing:.5px}
.ht{font-size:12px;color:#5a544c;background:#fff;border:1px solid var(--line);padding:2px 10px;border-radius:99px}
.fchips{position:sticky;top:0;z-index:50;display:flex;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;background:rgba(247,244,238,.95);backdrop-filter:blur(10px);padding:12px 0;margin:10px 0 6px;border-bottom:1px solid var(--line)}
.fchips::-webkit-scrollbar{display:none}
.fchip{flex:none;display:inline-flex;align-items:center;gap:4px;padding:7px 14px;border-radius:99px;border:1px solid var(--line);background:#fff;color:var(--ink2);font-size:12.5px;font-family:var(--outfit);font-weight:500;cursor:pointer;transition:.15s;white-space:nowrap}
.fchip i{font-style:normal;font-size:10.5px;opacity:.6}
.fchip.on{background:var(--ink);color:#fff;border-color:var(--ink)}
.fday-h{display:flex;align-items:baseline;gap:10px;font-family:var(--serif);font-weight:700;font-size:19px;color:var(--ink);margin:26px 0 12px;position:sticky;top:54px;z-index:40;background:rgba(247,244,238,.95);backdrop-filter:blur(8px);padding:8px 0}
.fday-d{font-family:var(--outfit);font-weight:400;font-size:12.5px;color:var(--ink3)}
.cards{display:flex;flex-direction:column;gap:12px}
.fc{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 20px;box-shadow:var(--sh)}
.fc-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.fc-act{display:flex;gap:6px}
.fc-act button{width:26px;height:26px;border-radius:99px;border:1px solid var(--line);background:#fff;color:var(--ink3);font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.15s;padding:0;filter:grayscale(1);opacity:.55}
.fc-act button:hover{opacity:1;filter:none;border-color:#d8cfc0}
.fc.pinned{border-left:3px solid #e0a52a}
.fc.pinned .fpin{opacity:1;filter:none;background:#fdf3e0;border-color:#e0a52a}
#archbtn.on{background:var(--primary);color:#fff;border-color:var(--primary)}
.fb{display:inline-flex;align-items:center;gap:4px;font-family:var(--outfit);font-weight:600;font-size:11px;padding:3px 11px;border-radius:99px;letter-spacing:.3px}
.fc-t{font-family:var(--serif);font-weight:600;font-size:16px;line-height:1.55;color:var(--ink);margin-bottom:7px}
.fc-b{font-size:13.8px;color:#4a443b;line-height:1.8}
.fc-b p{margin:5px 0}
.fc-b a{color:var(--primary);text-decoration:none;border-bottom:1px solid rgba(168,57,31,.25)}
.fc-b strong{color:var(--ink)}
.idea{margin-top:9px;border-top:1px dashed var(--line);padding-top:8px}
.idea summary{cursor:pointer;font-family:var(--outfit);font-size:12px;font-weight:500;color:var(--ink3);list-style:none}
.idea summary::-webkit-details-marker{display:none}
.idea[open] summary{color:var(--primary)}
.idea p{font-size:13px;color:#5a544c;margin-top:6px;line-height:1.75}
.fc-go{display:inline-block;margin-top:9px;font-family:var(--outfit);font-size:12px;font-weight:500;color:var(--ink3);text-decoration:none}
.fc-go:hover{color:var(--primary)}
.fc[data-f="xuanti"]{border-left:3px solid var(--primary)}
#xt-btn{position:fixed;display:none;z-index:9999;background:#a8391f;color:#fff;border:none;border-radius:99px;padding:8px 14px;font-size:13px;font-weight:500;font-family:var(--outfit);box-shadow:0 6px 20px rgba(168,57,31,.35);cursor:pointer}
#xt-btn:hover{background:#8a2e18}
#xt-toast{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);background:rgba(29,29,31,.92);color:#fff;padding:11px 22px;border-radius:99px;font-size:13.5px;font-family:var(--outfit);font-weight:500;z-index:9999;opacity:0;transition:opacity .2s;pointer-events:none;backdrop-filter:blur(10px)}
#xt-toast.show{opacity:1}
#totop{position:fixed;right:18px;bottom:24px;width:42px;height:42px;border-radius:99px;background:#fff;border:1px solid var(--line);color:var(--ink2);font-size:17px;display:none;align-items:center;justify-content:center;cursor:pointer;z-index:200;box-shadow:0 6px 18px rgba(60,40,20,.1);text-decoration:none}
#totop:hover{color:var(--primary);border-color:var(--primary)}
@media(max-width:640px){
  .wrap{padding:20px 12px 50px}
  .xt-link{position:static;display:inline-flex;align-items:center;margin-bottom:10px;font-size:12px}
  .hero h1{font-size:22px}
  .fc{padding:13px 15px;border-radius:14px}
  .fc-t{font-size:15px}
  .fc-b{font-size:13.2px}
  .fday-h{font-size:16.5px;top:50px}
}
</style></head><body><div class="wrap">
<a class="xt-link" href="选题清单.html">📌 选题清单<span id="xt-cnt">0</span></a>
<div class="hero"><h1>📰 AI 情报流</h1><div class="sub">每天两更（美东 10:00 / 23:00）· 划词可加入选题清单 · <a href="日历.html">📅 日历归档</a> · {{STAT}}</div></div>
{{HOT}}
<nav class="fchips" id="fchips">{{CHIPS}}<button class="fchip" id="archbtn" style="margin-left:auto">🗂 已读归档 <i id="archn">0</i></button></nav>
<section class="fday" id="pinsec" style="display:none"><h2 class="fday-h"><span>📌 钉住</span></h2><div class="cards" id="pinbox"></div></section>
{{FEED}}
<div style="text-align:center;color:var(--ink3);font-size:12px;margin-top:24px">只显示最近 5 天 · 更早的去 <a href="日历.html" style="color:var(--primary)">日历归档</a> 翻</div>
</div>
<button id="xt-btn">+ 加入选题</button>
<a id="totop" href="#" title="回到顶部">↑</a>
<div id="xt-toast"></div>
<script>
(function(){
  // 计数
  function updCnt(){var l=[];try{l=JSON.parse(localStorage.getItem("xtlist")||"[]")}catch(e){};l=l.filter(function(x){return x&&!x.deleted;});var e=document.getElementById("xt-cnt");if(e)e.textContent=l.length;}
  updCnt();
  // ===== 已读/钉住状态(localStorage,14天自动清理) =====
  function rdState(k){try{return JSON.parse(localStorage.getItem(k)||"{}")}catch(e){return{}}}
  function wrState(k,v){var now=Date.now();Object.keys(v).forEach(function(c){if(now-v[c]>1209600000)delete v[c];});localStorage.setItem(k,JSON.stringify(v));}
  var READ=rdState("fdRead"),PIN=rdState("fdPin"),mode="feed",curF="all";
  var pinOrigin={}; // cid -> 原day容器(取消钉住放回去)
  function pinDom(card){var cid=card.getAttribute("data-cid");pinOrigin[cid]=card.parentElement;card.classList.add("pinned");document.getElementById("pinbox").appendChild(card);}
  function unpinDom(card){var cid=card.getAttribute("data-cid");card.classList.remove("pinned");var o=pinOrigin[cid];if(o)o.insertBefore(card,o.firstChild);delete pinOrigin[cid];}
  function applyView(){
    document.querySelectorAll(".fc").forEach(function(x){
      var cid=x.getAttribute("data-cid"),isRead=!!READ[cid];
      var typeOk=(curF==="all"||x.getAttribute("data-f")===curF);
      x.classList.toggle("isread",isRead);
      x.style.display=(mode==="arch"?(isRead&&typeOk):(!isRead&&typeOk))?"":"none";
      var fx=x.querySelector(".fx");if(fx){fx.textContent=mode==="arch"?"↩":"✕";fx.title=mode==="arch"?"恢复到主页":"标记已读,收进归档";}
      var fp=x.querySelector(".fpin");if(fp)fp.style.display=mode==="arch"?"none":"";
    });
    document.querySelectorAll(".fday").forEach(function(sc){
      if(sc.id==="pinsec"){sc.style.display=(mode==="feed"&&document.getElementById("pinbox").children.length)?"":"none";return;}
      var vis=[].slice.call(sc.querySelectorAll(".fc")).some(function(x){return x.style.display!=="none"});
      sc.style.display=vis?"":"none";});
    var n=0;document.querySelectorAll(".fc").forEach(function(x){if(READ[x.getAttribute("data-cid")])n++;});
    document.getElementById("archn").textContent=String(n);
  }
  // 初始:恢复钉住卡到顶部
  document.querySelectorAll(".fc").forEach(function(x){if(PIN[x.getAttribute("data-cid")])pinDom(x);});
  applyView();
  // 类型筛选 + 归档切换
  document.getElementById("fchips").addEventListener("click",function(e){
    var ab=e.target.closest("#archbtn");
    if(ab){mode=(mode==="feed"?"arch":"feed");ab.classList.toggle("on",mode==="arch");applyView();return;}
    var c=e.target.closest(".fchip");if(!c)return;
    document.querySelectorAll(".fchip").forEach(function(x){if(x.id!=="archbtn")x.classList.remove("on")});c.classList.add("on");
    curF=c.getAttribute("data-f");applyView();
  });
  // 卡片按钮:✕已读(归档里=↩恢复) / 📌钉住
  document.addEventListener("click",function(e){
    var xb=e.target.closest(".fx"),pb=e.target.closest(".fpin");
    if(!xb&&!pb)return;
    e.stopPropagation();
    var card=e.target.closest(".fc");if(!card)return;var cid=card.getAttribute("data-cid");
    if(xb){
      if(mode==="arch"){delete READ[cid];toast("↩ 已恢复到主页");}
      else{READ[cid]=Date.now();if(PIN[cid]){delete PIN[cid];unpinDom(card);wrState("fdPin",PIN);}toast("✓ 已读，收进归档");}
      wrState("fdRead",READ);applyView();
    }else{
      if(PIN[cid]){delete PIN[cid];unpinDom(card);toast("已取消钉住");}
      else{PIN[cid]=Date.now();pinDom(card);toast("📌 已钉住（置顶）");}
      wrState("fdPin",PIN);applyView();
    }
  });
  // 划词收藏(卡片=一条,选中即取整卡标题+正文)
  var sel="",cachedFull="",cachedUrl="",cachedSrc="",btn=document.getElementById("xt-btn"),tst=document.getElementById("xt-toast");
  function hide(){btn.style.display="none";}
  var shownAtY=0;
  function show(x,y){shownAtY=window.scrollY;btn.style.left=Math.max(10,Math.min(window.innerWidth-110,x-50))+"px";btn.style.top=Math.max(10,Math.min(window.innerHeight-50,y-44))+"px";btn.style.display="block";}
  function toast(m){tst.textContent=m;tst.classList.add("show");setTimeout(function(){tst.classList.remove("show")},1800);}
  function grab(){var s=window.getSelection();if(!s||!s.rangeCount)return null;var n=s.getRangeAt(0).commonAncestorContainer;while(n&&n.nodeType===3)n=n.parentNode;var c=n&&n.closest?n.closest(".fc"):null;
    if(c){var t=c.querySelector(".fc-t"),b=c.querySelector(".fc-b");
      var tx=function(el){return el?(el.innerText||el.textContent||"").trim():"";};
      return {text:[tx(t),tx(b)].filter(Boolean).join(String.fromCharCode(10,10)).trim(),url:c.getAttribute("data-url")||"",src:c.getAttribute("data-src")||document.title};}
    return {text:s.toString().trim(),url:"",src:document.title};}
  function onSel(x,y){var t=(window.getSelection()||"").toString().trim();if(!t){hide();return;}sel=t;var g=grab();cachedFull=g&&g.text?g.text:t;cachedUrl=g?g.url:"";cachedSrc=g?g.src:document.title;show(x,y);}
  document.addEventListener("mouseup",function(e){setTimeout(function(){onSel(e.clientX,e.clientY)},10);});
  document.addEventListener("touchend",function(e){var tch=(e.changedTouches&&e.changedTouches[0])||{};setTimeout(function(){onSel(tch.clientX||100,tch.clientY||100)},10);});
  function killPop(){var old=document.querySelectorAll("#xt-pop");for(var i=0;i<old.length;i++)old[i].remove();}
  document.addEventListener("scroll",function(){if(btn.style.display==="block"&&Math.abs(window.scrollY-shownAtY)>90){hide();killPop();}},{passive:true});
  btn.addEventListener("mousedown",function(e){e.preventDefault();});
  btn.addEventListener("touchstart",function(e){e.preventDefault();e.stopPropagation();btn.click();},{passive:false});
  function getAccts(){var d=["偷懒记","Shulex","flatkey","其他"];try{var v=JSON.parse(localStorage.getItem("xtaccts")||"null");if(v&&v.length)return v;}catch(e){};localStorage.setItem("xtaccts",JSON.stringify(d));return d;}
  function defAcct(){return localStorage.getItem("xtdefacct")||getAccts()[0];}
  btn.addEventListener("click",function(ev){
    ev.stopPropagation();killPop();
    var full=cachedFull||sel;if(full.length>1500)full=full.slice(0,1500);
    var u=cachedUrl,sc=cachedSrc;
    var pop=document.createElement("div");pop.id="xt-pop";pop.style.cssText="position:fixed;background:#fff;border:1px solid #eeeef0;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.12);padding:8px;z-index:10000;min-width:180px;font-family:'Outfit',sans-serif;font-weight:500;font-size:13.5px";
    var x=parseFloat(btn.style.left)||100,y=parseFloat(btn.style.top)||100;pop.style.left=Math.max(10,Math.min(window.innerWidth-200,x))+"px";pop.style.top=(y+40)+"px";
    pop.innerHTML='<div style="font-size:11px;color:#86868b;padding:4px 12px 6px;font-weight:400">收到哪个账号？(点旁边=存默认)</div>'+getAccts().map(function(a){return '<div data-a="'+a.replace(/"/g,"&quot;")+'" style="padding:9px 14px;cursor:pointer;border-radius:9px;color:#1d1d1f">'+a+(a===defAcct()?' <span style="color:#a8391f;font-size:11px">·默认</span>':'')+'</div>';}).join("");
    var saved=false;
    pop.addEventListener("click",function(e){var a=e.target.closest("[data-a]");if(!a)return;var acct=a.getAttribute("data-a");localStorage.setItem("xtdefacct",acct);saved=true;saveOne(full,acct,u,sc);pop.remove();});
    document.body.appendChild(pop);
    setTimeout(function(){document.addEventListener("click",function rm(ev){if(!pop.contains(ev.target)){if(!saved&&document.body.contains(pop)){saved=true;saveOne(full,defAcct(),u,sc);}pop.remove();document.removeEventListener("click",rm);}});},50);
    hide();
  });
  function xtSync(l){
    var _pw=document.cookie.match(/dpw=([^;]+)/);
    if(!_pw||typeof CryptoJS==="undefined")return;
    var _s=CryptoJS.lib.WordArray.create(new Uint8Array([55,65,122,91,17,200,157,46,100,240,163,25,136,92,215,66]));
    var h=CryptoJS.PBKDF2(decodeURIComponent(_pw[1]),_s,{keySize:4,iterations:10000,hasher:CryptoJS.algo.SHA256}).toString();
    var url="http://skill101-news.oss-cn-hangzhou.aliyuncs.com/xtsync/"+h+".json";
    fetch(url+"?_t="+Date.now(),{cache:"no-store"}).then(function(r){return r.ok?r.json():[];}).catch(function(){return [];}).then(function(remote){
      var seen={},merged=[];
      (l||[]).concat(Array.isArray(remote)?remote:[]).forEach(function(it){var k=it.id||((it.ts||0)+"|"+(it.text||"").slice(0,40));if(!seen[k]){seen[k]=true;merged.push(it);}});
      merged.sort(function(a,b){return (b.ts||0)-(a.ts||0);});
      localStorage.setItem("xtlist",JSON.stringify(merged));updCnt();
      fetch(url,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(merged)}).catch(function(){});
    });
  }
  function saveOne(full,acct,u,sc){
    var frag="";try{frag="#:~:text="+encodeURIComponent(full.slice(0,80));}catch(e){}
    var l=[];try{l=JSON.parse(localStorage.getItem("xtlist")||"[]")}catch(e){}
    l.unshift({id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),text:full,src:sc||document.title,url:u,fragment:frag,account:acct,tags:[],note:"",ts:Date.now()});
    localStorage.setItem("xtlist",JSON.stringify(l));
    updCnt();toast("✓ 已加入「"+acct+"」");
    if(window.getSelection)window.getSelection().removeAllRanges();
    xtSync(l);
  }
  var tt=document.getElementById("totop");
  if(tt){tt.addEventListener("click",function(e){e.preventDefault();window.scrollTo({top:0,behavior:"smooth"});});
  document.addEventListener("scroll",function(){tt.style.display=window.scrollY>window.innerHeight*2?"flex":"none";},{passive:true});}
})();
</script>
</body>'''

def cal_html(days, daykw, latest):
    cn=["一","二","三","四","五","六","日"]
    months=sorted({d[:7] for d in days})
    latest_ym = months[-1] if months else ""
    blocks=[]
    for ym in months:
        y,mo=int(ym[:4]),int(ym[5:7])
        cells="".join(f'<div class="dow">{c}</div>' for c in cn)
        cells+='<div class="pad"></div>'*datetime.date(y,mo,1).weekday()
        for day in range(1,calendar.monthrange(y,mo)[1]+1):
            ds=f"{y:04d}-{mo:02d}-{day:02d}"; r=days.get(ds,{})
            chips="".join(f'<span class="chip {TLABEL[k]["cls"]}" title="{TLABEL[k]["label"]}">{TLABEL[k]["emoji"]}</span>' for k in [t["key"] for t in TYPES] if k in r)
            kws=daykw.get(ds,[])
            kwhtml=('<div class="kw">'+''.join(f'<span>{html.escape(w)}</span>' for w in kws[:3])+'</div>') if kws else ''
            if r:
                # 整格可点(手机上14px的小chip根本点不中)——优先开合集,只有精读就开精读
                target = r.get("daily") or r.get("jingdu")
                cells+=f'<a class="day has" href="p/{target}"><span class="dn">{day}</span>{kwhtml}<div class="chips">{chips}</div></a>'
            else:
                cells+=f'<div class="day"><span class="dn">{day}</span>{kwhtml}<div class="chips">{chips}</div></div>'
        block=f'<section class="month"><h2>{y} 年 {mo} 月</h2><div class="grid">{cells}</div></section>'
        if ym != latest_ym:
            ndays=sum(1 for d in days if d.startswith(ym))
            block=f'<details class="mfold"><summary>{y} 年 {mo} 月 · {ndays} 天有日报</summary>{block}</details>'
        blocks.append(block)
    d_news, md_news = latest
    hi=highlights(md_news) if md_news else []
    hi_html=""
    if hi:
        items="".join(f'<li>{html.escape(t)}</li>' for t in hi)
        hi_html=f'<section class="hl"><div class="hl-h"><span>🔥 今日亮点新闻</span><a href="p/{d_news}_daily.html">看全文 →</a></div><ul>{items}</ul><div class="hl-d">{html.escape(d_news)} · 全球新闻选题日报</div></section>'
    # 今日快速入口
    today_html=""
    import datetime as _dt
    today=_dt.date.today().isoformat()
    # 今天/最近一天有数据的日期 → 用它当"今天的"入口
    target_day = today if today in days else (sorted(days.keys())[-1] if days else None)
    if target_day:
        chips=[]
        for t in TYPES:
            if t["key"] in days.get(target_day,{}):
                chips.append(f'<a class="qd-chip {t["cls"]}" href="p/{days[target_day][t["key"]]}">{t["emoji"]} {t["label"]}</a>')
        if chips:
            today_label="今日 · "+target_day if target_day==today else "最新 · "+target_day
            today_html=f'<section class="qd"><div class="qd-h">⏱️ {today_label}</div><div class="qd-grid">{"".join(chips)}</div></section>'
    # 近期热词
    allkw={}
    for d in sorted(daykw)[-14:]:
        for w in daykw[d]: allkw[w]=allkw.get(w,0)+1
    hot=sorted(allkw, key=lambda w:-allkw[w])[:14]
    hot_html=('<div class="hot"><span class="hot-l">近期热词</span>'+''.join(f'<span class="ht">{html.escape(w)}</span>' for w in hot)+'</div>') if hot else ''
    stat=" · ".join(f'{t["emoji"]}{t["label"]} {sum(1 for v in days.values() if t["key"] in v)}' for t in TYPES)
    legend="".join(f'<span><i class="dotn {t["cls"]}"></i>{t["emoji"]} {t["label"]}</span>' for t in TYPES)
    # 亮点/今日入口/热词已挪到信息流首页,归档页只留日历本体
    return DASH.replace("{{HL}}","").replace("{{TODAY}}","").replace("{{HOT}}","").replace("{{MONTHS}}","\n".join(reversed(blocks))).replace("{{STAT}}",html.escape(stat)).replace("{{LEGEND}}",legend)

DASH='''<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>日报看板</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&family=Noto+Serif+SC:wght@600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#f7f4ee;--card:#fffdfa;--primary:#a8391f;--ink:#241f1a;--ink2:#8a7f72;--ink3:#b8ab98;--line:#ece6da;--sh:0 8px 26px rgba(60,40,20,.05);
--sans:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,sans-serif;--serif:'Noto Serif SC',Georgia,'Songti SC',serif;--outfit:'Outfit',var(--sans)}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:#3d3d40;font-family:var(--sans);font-weight:400;-webkit-font-smoothing:antialiased;overflow-x:hidden}
.wrap *{max-width:100%}
.wrap{max-width:1000px;margin:0 auto;padding:36px 24px 56px}
.back{display:inline-block;color:var(--ink2);font-size:13px;margin-bottom:10px;text-decoration:none}
.hero h1{font-family:var(--serif);font-weight:700;font-size:28px;letter-spacing:-.2px;color:var(--ink)}
.hero .sub{color:var(--ink2);margin-top:8px;font-size:13.5px;font-weight:400}
.hl{background:#fff;border-radius:20px;box-shadow:var(--sh);border:1px solid var(--line);padding:20px 24px;margin:20px 0 8px;border-left:3px solid #ff453a}
.hl-h{display:flex;align-items:center;justify-content:space-between;font-family:var(--outfit);font-weight:600;font-size:15.5px;margin-bottom:10px}
.hl-h a{color:var(--primary);text-decoration:none;font-size:13px;font-weight:500}
.hl ul{list-style:none;margin:0}
.hl li{font-size:14px;color:#3d3d40;padding:8px 0 8px 18px;position:relative;border-bottom:1px solid var(--line);font-weight:400}
.hl li:last-child{border-bottom:none}
.hl li:before{content:"";position:absolute;left:0;top:15px;width:5px;height:5px;border-radius:99px;background:#ff453a}
.hl-d{color:var(--ink3);font-size:11.5px;margin-top:9px;font-weight:400}
.hot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:16px 0 4px}
.hot-l{font-family:var(--outfit);font-size:11px;font-weight:600;color:var(--ink3);text-transform:uppercase;letter-spacing:.5px}
.ht{font-size:12.5px;color:#5a5a5c;background:#fff;border:1px solid var(--line);padding:3px 11px;border-radius:99px;font-weight:400}
.legend{display:flex;gap:14px;flex-wrap:wrap;margin:18px 0 22px;font-size:12.5px;color:var(--ink2);font-weight:400}
.legend span{display:inline-flex;align-items:center;gap:5px}
.xt-link{position:fixed;top:18px;right:18px;background:#fff;border:1px solid var(--line);border-radius:99px;padding:7px 15px;font-size:12.5px;color:var(--primary);text-decoration:none;font-family:'Outfit',sans-serif;font-weight:500;z-index:100;box-shadow:0 4px 14px rgba(60,40,20,.06);transition:.15s}
.xt-link:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(60,40,20,.08);text-decoration:none}
.xt-link span{background:#ff453a;color:#fff;border-radius:99px;padding:1px 7px;font-size:10.5px;margin-left:5px;font-weight:600}
.qd{background:#fff;border-radius:20px;box-shadow:var(--sh);border:1px solid var(--line);padding:18px 22px;margin:20px 0 8px;border-left:3px solid #e08a3c}
.qd-h{font-family:var(--outfit);font-weight:600;font-size:15.5px;color:var(--ink);margin-bottom:12px;letter-spacing:.2px}
.qd-grid{display:flex;flex-wrap:wrap;gap:10px}
.qd-chip{display:inline-flex;align-items:center;gap:7px;padding:12px 22px;border-radius:14px;text-decoration:none;color:var(--ink);font-family:var(--outfit);font-weight:600;font-size:14.5px;border:1px solid transparent;transition:.15s}
.qd-chip:hover{transform:translateY(-2px);box-shadow:var(--sh);text-decoration:none}
.dotn{width:9px;height:9px;border-radius:99px;display:inline-block}
.dotn.t-daily{background:#e08a3c}.dotn.t-j{background:#1a8a55}
.mfold{margin-bottom:14px}
.mfold summary{cursor:pointer;font-family:var(--outfit);font-weight:500;font-size:14px;color:var(--ink2);padding:14px 20px;background:var(--card);border:1px solid var(--line);border-radius:14px;list-style:none;transition:.15s}
.mfold summary::-webkit-details-marker{display:none}
.mfold summary:before{content:"▸ ";color:var(--ink3)}
.mfold[open] summary:before{content:"▾ "}
.mfold summary:hover{color:var(--ink);box-shadow:var(--sh)}
.mfold[open] summary{margin-bottom:12px}
#totop{position:fixed;right:18px;bottom:24px;width:42px;height:42px;border-radius:99px;background:#fff;border:1px solid var(--line);color:var(--ink2);font-size:17px;display:none;align-items:center;justify-content:center;cursor:pointer;z-index:200;box-shadow:0 6px 18px rgba(60,40,20,.1);text-decoration:none}
#totop:hover{color:var(--primary);border-color:var(--primary)}
.month{background:var(--card);border-radius:22px;box-shadow:var(--sh);padding:22px 24px 26px;margin-bottom:22px;border:1px solid var(--line)}
.month h2{font-family:var(--serif);font-weight:600;font-size:18px;margin-bottom:16px;letter-spacing:0;color:var(--ink)}
.grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:7px;width:100%}
.dow{font-family:var(--outfit);font-weight:500;font-size:12px;color:var(--ink3);text-align:center;padding-bottom:6px}
.pad{aspect-ratio:1/1.05}
.day{aspect-ratio:1/1.05;border-radius:13px;border:1px solid var(--line);padding:7px 6px;display:flex;flex-direction:column;background:#fcfcfd;overflow:hidden;min-width:0;text-decoration:none;color:inherit}
.day.has{background:#fff;box-shadow:var(--sh);cursor:pointer;transition:.15s}
a.day.has:hover{transform:translateY(-2px);border-color:#e0b48a;box-shadow:0 8px 20px rgba(60,40,20,.1)}
.dn{font-family:var(--outfit);font-weight:500;font-size:13px;color:var(--ink3)}
.day.has .dn{color:var(--ink)}
.kw{margin-top:4px;display:flex;flex-direction:column;gap:1px;overflow:hidden}
.kw span{font-size:10px;color:#9a9a9e;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:400}
.chips{margin-top:auto;display:flex;gap:3px;flex-wrap:wrap;padding-top:4px}
.chip{width:21px;height:21px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:11.5px;text-decoration:none;transition:.15s;flex-shrink:1;min-width:0}
.chip:hover{transform:translateY(-2px)}
.t-daily{background:#fdf1e7}.t-j{background:#e6f4ec}
.foot{color:var(--ink3);font-size:11.5px;text-align:center;margin-top:14px;font-weight:400}
@media(max-width:640px){
  html,body{overflow-x:hidden}
  .wrap{padding:18px 10px 40px;max-width:100%;width:100%}
  .xt-link{position:static;display:inline-flex;align-items:center;margin-bottom:10px;font-size:12px}
  .hero h1{font-size:22px}
  .hero .sub{font-size:12px;line-height:1.65;word-break:break-word}
  .hl{padding:14px 16px;border-radius:16px;margin:14px 0 4px}
  .hl-h{font-size:14.5px;gap:8px;flex-wrap:wrap}
  .hl li{font-size:13px;padding:7px 0 7px 14px;line-height:1.55}
  .hl li:before{top:13px;width:4px;height:4px}
  .hl-d{font-size:11px}
  .qd{padding:14px 16px;border-radius:16px;margin:10px 0 4px}
  .qd-h{font-size:13px}
  .qd-chip{padding:10px 18px;font-size:13.5px}
  .hot{gap:5px;margin:12px 0 4px}
  .hot-l{font-size:10px}
  .ht{font-size:11px;padding:2px 8px}
  .legend{gap:8px;font-size:11px;margin:12px 0 14px}
  .month{padding:14px 10px 16px;border-radius:16px;margin-bottom:14px}
  .month h2{font-size:15.5px;margin-bottom:10px}
  .grid{gap:3px;width:100%}
  .dow{font-size:10px;padding-bottom:4px}
  .day{padding:4px 2px;border-radius:8px;aspect-ratio:auto;min-height:54px;overflow:hidden}
  .dn{font-size:10.5px;text-align:center}
  .kw{display:none}
  .chips{margin-top:auto;gap:2px;padding-top:3px;justify-content:center}
  .chip{width:18px;height:18px;border-radius:5px;font-size:10.5px}
  .mfold summary{padding:11px 14px;font-size:13px}
  .foot{font-size:10.5px}
}
</style></head><body><div class="wrap">
<div class="hero">
<a class="xt-link" href="选题清单.html">📌 选题清单<span id="xt-cnt">0</span></a>
<a class="back" href="index.html">← 回情报流</a>
<h1>📅 日历归档</h1><div class="sub">点日历格子 → 打开那天的日报合集。{{STAT}}</div></div>
{{TODAY}}
{{HL}}
{{HOT}}
<div class="legend">{{LEGEND}}</div>
{{MONTHS}}
<div class="foot">此看板由 build-dashboard.py 自动生成 · 每天 loop 跑完刷新 · news.skill101.cn</div>
</div>
<a id="totop" href="#" title="回到顶部">↑</a>
<script>(function(){var l=[];try{l=JSON.parse(localStorage.getItem("xtlist")||"[]")}catch(e){};l=l.filter(function(x){return x&&!x.deleted;});var e=document.getElementById("xt-cnt");if(e)e.textContent=l.length;
var tt=document.getElementById("totop");
if(tt){tt.addEventListener("click",function(ev){ev.preventDefault();window.scrollTo({top:0,behavior:"smooth"});});
document.addEventListener("scroll",function(){tt.style.display=window.scrollY>window.innerHeight*2?"flex":"none";},{passive:true});}
})();</script>
</body>'''

WISHLIST_HTML = '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n<title>选题清单</title>\n<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&family=Noto+Serif+SC:wght@600;700&display=swap" rel="stylesheet">\n<style>\n:root{--bg:#f7f4ee;--card:#fffdfa;--primary:#a8391f;--ink:#241f1a;--ink2:#8a7f72;--ink3:#b8ab98;--line:#ece6da;--sh:0 8px 26px rgba(60,40,20,.05);\n--sans:-apple-system,BlinkMacSystemFont,\'Inter\',\'Segoe UI\',Roboto,sans-serif;--serif:\'Noto Serif SC\',Georgia,\'Songti SC\',serif;--outfit:\'Outfit\',var(--sans)}\n*{box-sizing:border-box;margin:0;padding:0}\nbody{background:var(--bg);color:#3d3d40;font-family:var(--sans);font-size:15px;font-weight:400;-webkit-font-smoothing:antialiased;line-height:1.7}\n.wrap{max-width:860px;margin:0 auto;padding:36px 22px 60px}\n.back{display:inline-block;color:var(--ink2);font-size:13px;margin-bottom:16px;font-weight:400;text-decoration:none}\n.head{display:flex;align-items:center;gap:14px;margin-bottom:8px;flex-wrap:wrap}\n.head h1{font-family:var(--serif);font-weight:700;font-size:27px;letter-spacing:-.2px;color:var(--ink)}\n.cnt{background:#a8391f;color:#fff;border-radius:99px;padding:3px 13px;font-family:var(--outfit);font-weight:600;font-size:13px}\n.sub{color:var(--ink2);font-size:13px;margin:6px 0 18px;font-weight:400}\n.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;padding:8px;background:#fff;border-radius:14px;border:1px solid var(--line);box-shadow:var(--sh)}\n.tab{padding:7px 14px;border-radius:9px;font-size:13px;font-weight:500;font-family:var(--outfit);color:var(--ink2);cursor:pointer;border:1px solid transparent;background:transparent;display:flex;align-items:center;gap:6px}\n.tab.on{background:var(--primary);color:#fff}\n.tab:hover:not(.on){background:#fafafb;color:var(--ink)}\n.tab .n{font-size:11px;opacity:.7;font-weight:600}\n.tab.on .n{opacity:.85}\n.tab-add{color:var(--primary);font-weight:600;cursor:pointer;font-size:13px}\n.tagrow{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}\n.tagchip{font-size:11.5px;padding:3px 10px;border-radius:99px;background:#fff;border:1px solid var(--line);color:var(--ink2);cursor:pointer;font-family:var(--outfit);font-weight:500;transition:.15s}\n.tagchip.on{background:#a8391f;color:#fff;border-color:#a8391f}\n.bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}\n.bar button{border:1px solid var(--line);background:#fff;border-radius:99px;padding:8px 16px;font-size:13px;font-weight:500;font-family:var(--outfit);color:var(--ink);cursor:pointer;transition:.15s}\n.bar button:hover{transform:translateY(-1px);box-shadow:var(--sh)}\n.bar button.pri{background:var(--primary);color:#fff;border-color:var(--primary)}\n.bar button.dng{color:#c8102e}\n.empty{background:#fff;border-radius:20px;border:1px solid var(--line);padding:60px 30px;text-align:center;color:var(--ink2)}\n.empty .em{font-size:42px;margin-bottom:14px}\n.empty .ti{font-family:var(--outfit);font-weight:600;font-size:17px;color:var(--ink);margin-bottom:8px}\n.empty .ds{font-size:13.5px;line-height:1.8}\n.card{background:#fff;border-radius:16px;border:1px solid var(--line);box-shadow:var(--sh);padding:18px 22px;margin-bottom:12px;position:relative}\n.card .acct{display:inline-block;font-family:var(--outfit);font-weight:600;font-size:11.5px;padding:2px 10px;border-radius:99px;background:#eaf3fd;color:#a8391f;margin-bottom:10px;cursor:pointer}\n.card .acct:hover{filter:brightness(.97)}\n.card .tx{font-size:14px;color:#2a2a2c;line-height:1.7;font-weight:400;border-left:3px solid #e3ecf7;padding:6px 14px;background:#fafbfc;border-radius:8px;margin-bottom:10px;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow-y:auto}\n.card .tags{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px;align-items:center}\n.card .tg{font-size:11px;padding:2px 9px;border-radius:99px;background:#fdf3ea;color:#9a6a12;font-family:var(--outfit);font-weight:500;display:inline-flex;align-items:center;gap:4px}\n.card .tg .tx{padding:0;background:none;border:none;margin:0}\n.card .tg span{cursor:pointer;color:#c0a878;font-weight:400;margin-left:2px}\n.card .tg span:hover{color:#c8102e}\n.card .tg-add{font-size:11px;color:var(--ink3);background:#fafafb;border:1px dashed var(--line);padding:2px 10px;border-radius:99px;cursor:pointer;font-family:var(--outfit);font-weight:500}\n.card .tg-add:hover{color:var(--primary);border-color:var(--primary)}\n.card .meta{display:flex;align-items:center;gap:10px;font-size:11.5px;color:var(--ink3);flex-wrap:wrap;font-family:var(--outfit);font-weight:400}\n.card .meta a{color:var(--primary);text-decoration:none}\n.card .meta a:hover{text-decoration:underline}\n.card .nt{display:block;width:100%;border:1px dashed var(--line);background:#fafafb;border-radius:10px;padding:8px 12px;margin-top:10px;font-size:13px;color:#48484a;font-family:inherit;resize:vertical;min-height:36px;font-weight:400;line-height:1.6}\n.card .nt:focus{outline:none;border-color:#a8391f;border-style:solid;background:#fff}\n.card .act{position:absolute;top:14px;right:14px;display:flex;gap:6px}\n.card .x{border:none;background:#f3f3f5;color:var(--ink2);border-radius:99px;width:24px;height:24px;font-size:14px;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center}\n.card .x:hover{background:#ffe2e6;color:#c8102e}\n.card .cpbtn{margin-top:10px;width:100%;border:1px solid var(--line);background:#fff;border-radius:10px;padding:9px 14px;font-size:13px;font-weight:500;font-family:var(--outfit);color:#0071e3;cursor:pointer;transition:.15s;display:flex;align-items:center;justify-content:center;gap:6px}\n.card .cpbtn:hover{background:#eaf3fd;border-color:#0071e3}\n.card .cpbtn:active{transform:scale(.98)}\n#tst{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);background:rgba(29,29,31,.92);color:#fff;padding:11px 22px;border-radius:99px;font-size:13.5px;font-family:var(--outfit);font-weight:500;z-index:9999;opacity:0;transition:opacity .2s;pointer-events:none;backdrop-filter:blur(10px)}\n#tst.show{opacity:1}\n@media(max-width:640px){body{font-size:14px}.wrap{padding:22px 12px 50px}.head h1{font-size:22px}.card{padding:14px 16px;border-radius:14px}.card .tx{font-size:13.5px;padding:6px 12px}.bar button,.tab{padding:7px 12px;font-size:12px}}\n</style></head><body><div class="wrap">\n<a class="back" href="index.html">← 回日历看板</a>\n<div class="head"><h1>📌 选题清单</h1><span class="cnt" id="cnt">0</span></div>\n<div class="sub">日报页 <b>划词</b> 一点就收藏（自动取整段+链回原文）。多账号管理、标签筛选、跨设备同步。</div>\n<div class="tabs" id="tabs"></div>\n<div class="tagrow" id="tagrow"></div>\n<div class="bar">\n  <button class="pri" onclick="exp()">📋 导出 Markdown</button>\n  <button onclick="expJSON()">导出 JSON</button>\n  <button onclick="mgrAcct()">账号管理</button>\n  <button class="dng" onclick="clr()">清空全部</button>\n</div>\n<div id="list"></div>\n<div id="tst"></div>\n<script>\nconst SYNC_BASE="http://skill101-news.oss-cn-hangzhou.aliyuncs.com/xtsync/";\nconst NL=String.fromCharCode(10);\nfunction _kk(){const m=document.cookie.match(/dpw=([^;]+)/);if(!m)return null;const salt=CryptoJS.lib.WordArray.create(new Uint8Array([55,65,122,91,17,200,157,46,100,240,163,25,136,92,215,66]));return CryptoJS.PBKDF2(decodeURIComponent(m[1]),salt,{keySize:4,iterations:10000,hasher:CryptoJS.algo.SHA256}).toString();}\nasync function syncPull(){const k=_kk();if(!k)return null;try{const r=await fetch(SYNC_BASE+k+".json?_t="+Date.now(),{cache:"no-store"});if(!r.ok)return null;return await r.json();}catch(e){return null;}}\nasync function syncPush(l){const k=_kk();if(!k)return;try{await fetch(SYNC_BASE+k+".json",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(l)});}catch(e){}}\nfunction keyOf(it){return it.id||((it.ts||0)+"|"+(it.text||"").slice(0,40));}\n// 墓碑合并:同一条以"最后一次操作时间"新的为准(删除也是操作)——手机删掉的不会被电脑复活\nfunction _mg(a,b){const m={};(a||[]).concat(b||[]).forEach(it=>{if(!it)return;const k=keyOf(it);const cur=m[k];if(!cur){m[k]=it;return;}const ct=cur.delTs||cur.editTs||cur.ts||0,it2=it.delTs||it.editTs||it.ts||0;if(it2>ct)m[k]=it;else if(it2===ct&&(it.note||"").length>(cur.note||"").length)m[k]=it;});return Object.values(m).sort((x,y)=>(y.ts||0)-(x.ts||0));}\nfunction readAll(){try{return JSON.parse(localStorage.getItem("xtlist")||"[]")}catch(e){return []}}\nfunction read(){return readAll().filter(x=>x&&!x.deleted);}\nfunction writeAll(l){const now=Date.now();localStorage.setItem("xtlist",JSON.stringify((l||[]).filter(x=>!(x&&x.deleted&&x.delTs&&now-x.delTs>2592000000))));}\nfunction save(l){writeAll(l);render();syncPush(readAll());}\nfunction getAccts(){const def=["偷懒记","Shulex","flatkey","其他"];try{const v=JSON.parse(localStorage.getItem("xtaccts")||"null");if(v&&v.length)return v;}catch(e){};localStorage.setItem("xtaccts",JSON.stringify(def));return def;}\nfunction setAccts(a){localStorage.setItem("xtaccts",JSON.stringify(a));}\nfunction fmtT(ts){const d=new Date(ts);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")+" "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")}\nfunction esc(s){return (s+"").replace(/[&<>"\']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",\'"\':"&quot;","\'":"&#39;"}[c]))}\nfunction toast(m){const t=document.getElementById("tst");t.textContent=m;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),1800);}\n// 剪贴板统一入口:http站点navigator.clipboard是undefined,必须走textarea兜底\nfunction copyText(str,ok){function fb(){const ta=document.createElement("textarea");ta.value=str;document.body.appendChild(ta);ta.select();try{document.execCommand("copy")}catch(e){}ta.remove();toast(ok);}if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(str).then(()=>toast(ok)).catch(fb);}else fb();}\nfunction fullLink(it){return it.url?(location.origin+"/p/"+it.url+(it.fragment||"")):"";}\n\nlet curAcct="全部",curTag="";\nfunction tagsAll(){const t={};read().forEach(it=>(it.tags||[]).forEach(x=>t[x]=(t[x]||0)+1));return Object.entries(t).sort((a,b)=>b[1]-a[1]);}\n\nfunction render(){\n  const l=read();document.getElementById("cnt").textContent=l.length;\n  const accts=getAccts();\n  const cntByA={};accts.forEach(a=>cntByA[a]=l.filter(x=>x.account===a).length);\n  document.getElementById("tabs").innerHTML=\'<button class="tab \'+(curAcct==="全部"?"on":"")+\'" data-acct="全部">全部 <span class="n">\'+l.length+\'</span></button>\'+\n    accts.map(a=>\'<button class="tab \'+(curAcct===a?"on":"")+\'" data-acct="\'+esc(a)+\'">\'+esc(a)+\' <span class="n">\'+(cntByA[a]||0)+\'</span></button>\').join("")+\n    \'<button class="tab-add">+ 新账号</button>\';\n  const ta=tagsAll();\n  document.getElementById("tagrow").innerHTML=ta.length?\n    \'<span class="tagchip \'+(curTag===""?"on":"")+\'" data-tag="">全部标签</span>\'+\n    ta.map(([t,n])=>\'<span class="tagchip \'+(curTag===t?"on":"")+\'" data-tag="\'+esc(t)+\'">\'+esc(t)+\' \'+n+\'</span>\').join(""):"";\n  let lst=l;\n  if(curAcct!=="全部")lst=lst.filter(it=>it.account===curAcct);\n  if(curTag)lst=lst.filter(it=>(it.tags||[]).indexOf(curTag)>=0);\n  const box=document.getElementById("list");\n  if(!lst.length){box.innerHTML=\'<div class="empty"><div class="em">📭</div><div class="ti">\'+(curAcct==="全部"&&!curTag?"选题清单是空的":"这个筛选下没有选题")+\'</div><div class="ds">\'+(curAcct==="全部"&&!curTag?\'去日报页用鼠标/手指 <b>划选</b> 一段文字 →<br>会浮起按钮，选个账号一点就来这里了\':\'换个账号或标签看看\')+\'</div></div>\';return;}\n  box.innerHTML=lst.map(it=>{\n    const id=esc(keyOf(it));\n    const link=it.url?(\'p/\'+esc(it.url)+(it.fragment||"")):"";\n    const srcLink=it.url?\'<a href="\'+link+\'">\'+esc(it.src||"未命名")+\'</a>\':esc(it.src||"未命名");\n    const tagsHtml=(it.tags||[]).map(t=>\'<span class="tg">\'+esc(t)+\'<span class="tg-rm" data-t="\'+esc(t)+\'">×</span></span>\').join("")+\'<span class="tg-add">+ 标签</span>\';\n    return \'<div class="card" data-id="\'+id+\'">\'+\n      \'<span class="acct">📂 \'+esc(it.account||"其他")+\' ▾</span>\'+\n      \'<div class="tx">\'+esc(it.text)+\'</div>\'+\n      \'<div class="tags">\'+tagsHtml+\'</div>\'+\n      \'<textarea class="nt" placeholder="加点备注...">\'+esc(it.note||"")+\'</textarea>\'+\n      \'<div class="meta">⏰ \'+fmtT(it.ts)+\' · 来自 \'+srcLink+\'</div>\'+\n      \'<button class="cpbtn">📋 复制文案+链接</button>\'+\n      \'<div class="act"><button class="x" title="删除">×</button></div></div>\';\n  }).join("");\n}\nfunction idx(id){const l=readAll();for(let i=0;i<l.length;i++)if(keyOf(l[i])===id)return [l,i];return [l,-1];}\nfunction setA(a){curAcct=a;render();}\nfunction setT(t){curTag=t;render();}\nfunction addAcct(){const n=prompt("新账号名称（如：抖音号、微信公众号、客户A...）");if(!n||!n.trim())return;const v=getAccts();if(v.indexOf(n.trim())>=0){toast("已存在");return;}v.push(n.trim());setAccts(v);render();toast("已加 "+n.trim());}\nfunction chAcct(id){const r=idx(id),l=r[0],i=r[1];if(i<0)return;const accts=getAccts();const cur=l[i].account||accts[0];const next=accts[(accts.indexOf(cur)+1)%accts.length];l[i].account=next;l[i].editTs=Date.now();save(l);toast("→ "+next);}\nfunction addTag(id){const t=prompt("加标签（短词，如：AI客服、爆款、跟进）");if(!t||!t.trim())return;const r=idx(id),l=r[0],i=r[1];if(i<0)return;l[i].tags=l[i].tags||[];if(l[i].tags.indexOf(t.trim())<0){l[i].tags.unshift(t.trim());l[i].editTs=Date.now();save(l);toast("+ "+t.trim());}}\nfunction rmTag(id,t){const r=idx(id),l=r[0],i=r[1];if(i<0)return;l[i].tags=(l[i].tags||[]).filter(x=>x!==t);l[i].editTs=Date.now();save(l);}\nfunction upd(id,v){const r=idx(id),l=r[0],i=r[1];if(i<0)return;l[i].note=v;l[i].editTs=Date.now();writeAll(l);clearTimeout(window._sd);window._sd=setTimeout(()=>syncPush(readAll()),600);}\nfunction del(id){if(!confirm("删除这一条？"))return;const r=idx(id),l=r[0],i=r[1];if(i<0)return;l[i].deleted=true;l[i].delTs=Date.now();save(l);toast("已删除")}\nfunction clr(){if(!confirm("清空所有选题？此操作不可恢复"))return;const now=Date.now();const l=readAll().map(x=>x.deleted?x:Object.assign({},x,{deleted:true,delTs:now}));save(l);toast("已清空")}\nfunction copyOne(id){const r=idx(id),l=r[0],i=r[1];if(i<0)return;const it=l[i];copyText([it.text,fullLink(it)].filter(Boolean).join(NL+NL),"✓ 已复制文案+链接");}\nfunction mgrAcct(){const v=getAccts();const n=prompt("现有账号："+NL+v.map((x,i)=>(i+1)+". "+x).join(NL)+NL+NL+"输入要删除的序号(1-"+v.length+")，或留空取消：");if(!n)return;const k=parseInt(n)-1;if(k<0||k>=v.length)return;if(!confirm("删除「"+v[k]+"」？已属此账号的选题会保留但归为\'其他\'"))return;const a=v[k];const l=readAll().map(x=>x.account===a?Object.assign({},x,{account:"其他",editTs:Date.now()}):x);v.splice(k,1);setAccts(v);writeAll(l);syncPush(readAll());if(v.indexOf(curAcct)<0)curAcct="全部";render();toast("已删");}\nfunction exp(){const l=read();if(!l.length){toast("清单是空的");return;}let md="# 选题清单 · 导出于 "+fmtT(Date.now())+NL+NL;const byA={};l.forEach(it=>{const a=it.account||"其他";(byA[a]=byA[a]||[]).push(it)});Object.entries(byA).forEach(([a,arr])=>{md+="## 📂 "+a+" ("+arr.length+")"+NL+NL;arr.forEach((it,i)=>{md+="### "+(i+1)+". 「"+it.text.slice(0,40)+(it.text.length>40?"…":"")+"」"+NL+NL+"> "+it.text.split(NL).join(NL+"> ")+NL+NL;if(it.tags&&it.tags.length)md+="**标签**："+it.tags.map(t=>"#"+t).join(" ")+NL+NL;if(it.note)md+="**备注**："+it.note+NL+NL;md+="**来源**：["+(it.src||"未命名")+"]("+fullLink(it)+") · "+fmtT(it.ts)+NL+NL+"---"+NL+NL;})});copyText(md,"Markdown 已复制 · 共 "+l.length+" 条");}\nfunction expJSON(){const l=read();if(!l.length){toast("清单是空的");return;}copyText(JSON.stringify(l,null,2),"JSON 已复制");}\n\n// 事件委托(不再往onclick里拼字符串——账号/标签带引号也不会炸)\ndocument.getElementById("tabs").addEventListener("click",function(e){if(e.target.closest(".tab-add")){addAcct();return;}const tb=e.target.closest(".tab");if(tb)setA(tb.getAttribute("data-acct"));});\ndocument.getElementById("tagrow").addEventListener("click",function(e){const tc=e.target.closest(".tagchip");if(tc)setT(tc.getAttribute("data-tag"));});\ndocument.getElementById("list").addEventListener("click",function(e){\n  const card=e.target.closest(".card");if(!card)return;const id=card.getAttribute("data-id");\n  if(e.target.closest(".x")){del(id);return;}\n  if(e.target.closest(".cpbtn")){copyOne(id);return;}\n  const rm=e.target.closest(".tg-rm");if(rm){rmTag(id,rm.getAttribute("data-t"));return;}\n  if(e.target.closest(".tg-add")){addTag(id);return;}\n  if(e.target.closest(".acct")){chAcct(id);return;}\n});\ndocument.getElementById("list").addEventListener("input",function(e){if(e.target.classList.contains("nt")){const card=e.target.closest(".card");if(card)upd(card.getAttribute("data-id"),e.target.value);}});\n\nrender();\n(async()=>{const r=await syncPull();const loc=readAll();if(r&&Array.isArray(r)){const m=_mg(loc,r);if(JSON.stringify(m)!==JSON.stringify(loc)){writeAll(m);render();toast("☁️ 已同步 "+read().length+" 条");}if(JSON.stringify(m)!==JSON.stringify(r))syncPush(m);}else if(loc.length){syncPush(loc);}})();\n</script></body>'

if __name__ == "__main__":
    days, daykw, latest, sec, jingdu_items = scan()
    open(os.path.join(SITE,"index.html"),'w',encoding='utf-8').write(wrap(feed_html(sec, jingdu_items, days, daykw), "AI 情报流", "cj.js"))
    open(os.path.join(SITE,"日历.html"),'w',encoding='utf-8').write(wrap(cal_html(days, daykw, latest), "日历归档", "cj.js"))
    open(os.path.join(SITE,"选题清单.html"),'w',encoding='utf-8').write(wrap(WISHLIST_HTML, "选题清单", "cj.js"))
    open(os.path.join(VAULT,"日报看板.html"),'w',encoding='utf-8').write(
        '<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=01_Projects/AI自媒体/选题雷达/site/index.html">'
        '<p>跳转中… <a href="01_Projects/AI自媒体/选题雷达/site/index.html">日报看板</a></p>')
    print(os.path.join(SITE,"index.html"), "| 天数:", len(days))
