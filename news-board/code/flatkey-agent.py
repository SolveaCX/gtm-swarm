#!/usr/bin/env python3
# 新闻 agent 引擎(稳定key,不依赖claude): gpt-5.5 套 agent 外壳,自主 web_search + fetch_page,搜够了写日报。
# 用法同 flatkey-news.py: --out --writer --queries <种子提示...> [--recency-days N] [--max-steps 10]
import os, sys, json, time, subprocess, argparse, urllib.request, urllib.parse, re, datetime
import html as html_mod

def kc(s):
    try: return subprocess.check_output(["security","find-generic-password","-s",s,"-w"],text=True).strip()
    except Exception: return ""
FK=kc("FLATKEY_API_KEY"); FC=kc("firecrawl-api-key")
FLAT="https://router.flatkey.ai/v1/chat/completions"
MODEL=os.environ.get("FLATKEY_NEWS_MODEL","gpt-5.5")

def _post(url,payload,headers,timeout=180):
    req=urllib.request.Request(url,data=json.dumps(payload).encode(),headers=headers,method="POST")
    with urllib.request.urlopen(req,timeout=timeout) as r: return json.loads(r.read().decode())

UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
_LAST=[0.0]
def _throttle(gap=2.0):
    import time as _t
    dt=_t.time()-_LAST[0]
    if dt<gap: _t.sleep(gap-dt)
    _LAST[0]=_t.time()

def _ddg(query, limit=10):
    _throttle()
    data=urllib.parse.urlencode({"q":query}).encode()
    req=urllib.request.Request("https://html.duckduckgo.com/html/",data=data,headers={"User-Agent":UA})
    page=urllib.request.urlopen(req,timeout=20).read().decode("utf-8","ignore")
    if "anomaly" in page.lower(): raise RuntimeError("ddg anomaly")
    results=re.findall(r'<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', page, re.S)
    snips=re.findall(r'class="result__snippet"[^>]*>(.*?)</a>', page, re.S)
    def clean(t): return re.sub(r'<[^>]+>','',html_mod.unescape(t)).strip()
    out=[]
    for i,(href,title) in enumerate(results[:limit]):
        m=re.search(r'uddg=([^&]+)', href)
        real=urllib.parse.unquote(m.group(1)) if m else href
        if real.startswith("//"): real="https:"+real
        out.append({"title":clean(title),"url":real,"desc":clean(snips[i])[:300] if i<len(snips) else ""})
    return out

def _gnews(query, recency_days=7, limit=10):
    # Google News RSS 兜底:免费抗压,带日期;链接是 news.google 跳转(浏览器里能正常打开真实文章)
    import xml.etree.ElementTree as ET
    when="1d" if recency_days<=1 else ("2d" if recency_days<=2 else ("7d" if recency_days<=7 else "1m"))
    q=f"{query} when:{when}"
    url=f"https://news.google.com/rss/search?q={urllib.parse.quote(q)}&hl=en-US&gl=US&ceid=US:en"
    _throttle(1.0)
    req=urllib.request.Request(url,headers={"User-Agent":UA})
    root=ET.fromstring(urllib.request.urlopen(req,timeout=20).read())
    out=[]
    for it in root.findall(".//item")[:limit]:
        src=it.find("{http://news.google.com}source")
        out.append({"title":it.findtext("title",""),
                    "url":it.findtext("link",""),"date":it.findtext("pubDate","")[:16],
                    "desc":(re.sub(r'<[^>]+>','',it.findtext("description","")))[:300],
                    "source":src.text if src is not None else ""})
    return out

_DDG_FAILS=[0]
def do_search(query, recency_days=7, limit=10):
    # 先 DDG(直链);连续失败2次触发熔断,本轮剩下直接走 Google News(不再干等)
    if _DDG_FAILS[0]<2:
        for attempt in range(2):
            try:
                out=_ddg(query,limit)
                if out: _DDG_FAILS[0]=0; return json.dumps(out,ensure_ascii=False)
                raise RuntimeError("ddg empty")
            except Exception:
                time.sleep(4)
        _DDG_FAILS[0]+=1
    try:
        out=_gnews(query,recency_days,limit)
        if out: return json.dumps(out,ensure_ascii=False)
    except Exception as e:
        return f"[搜索出错(DDG限流+GNews也失败)] {e}"
    return "[无结果]"

def _html2txt(h):
    h=re.sub(r'(?is)<(script|style|nav|footer|header|aside|form)[^>]*>.*?</\1>',' ',h)
    h=re.sub(r'(?is)<br\s*/?>','\n',h); h=re.sub(r'(?is)</(p|div|h[1-6]|li)>','\n',h)
    h=re.sub(r'(?s)<[^>]+>',' ',h); h=html_mod.unescape(h)
    h=re.sub(r'[ \t]+',' ',h); h=re.sub(r'\n\s*\n+','\n',h)
    return h.strip()
def do_fetch(url):
    try:
        req=urllib.request.Request(url,headers={"User-Agent":UA})
        raw=urllib.request.urlopen(req,timeout=20).read()
        try: txt=raw.decode("utf-8")
        except Exception: txt=raw.decode("latin-1","ignore")
        return _html2txt(txt)[:3500] or "[读取为空]"
    except Exception as e: return f"[读取出错] {e}"

TOOLS=[
 {"type":"function","function":{"name":"web_search","description":"搜最新新闻/资讯,返回标题+链接+日期+摘要的JSON。可多次调用换不同关键词。",
   "parameters":{"type":"object","properties":{"query":{"type":"string","description":"搜索词,中英文均可"},"recency_days":{"type":"integer","description":"只要近N天,默认7"}},"required":["query"]}}},
 {"type":"function","function":{"name":"fetch_page","description":"读取某个url的正文(markdown),用来核实细节/日期。",
   "parameters":{"type":"object","properties":{"url":{"type":"string"}},"required":["url"]}}},
]

def chat(messages, tools=None, timeout=300, retries=2):
    payload={"model":MODEL,"messages":messages}
    if tools: payload["tools"]=tools; payload["tool_choice"]="auto"
    last=""
    for _ in range(retries):
        try:
            d=_post(FLAT,payload,{"Authorization":f"Bearer {FK}","Content-Type":"application/json"},timeout)
            if "choices" in d: return d["choices"][0]["message"]
            last=json.dumps(d)[:300]
        except Exception as e: last=str(e)
        time.sleep(20)
    raise RuntimeError(f"gpt调用失败: {last}")

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--out",required=True)
    ap.add_argument("--writer",required=True)
    ap.add_argument("--queries",nargs="+",required=True,help="种子提示(方向,模型自己再决定具体搜什么)")
    ap.add_argument("--recency-days",type=int,default=7)
    ap.add_argument("--max-steps",type=int,default=10)
    ap.add_argument("--scrape",type=int,default=0,help="(兼容占位,agent自己决定读几篇)")
    a=ap.parse_args()
    today=datetime.date.today().isoformat()
    writer=open(a.writer,encoding="utf-8").read()
    system=("你是自主新闻 agent。用 web_search 搜、fetch_page 读原文,自己决定搜什么、搜几轮、读哪几篇,直到掌握足够真实素材。"
            f"今天是 {today},只要近 {a.recency_days} 天内的新闻。"
            "\n【铁律】① 只能用你真search/fetch到的事实和链接写,绝不编造任何新闻/数字/日期/链接,链接必须原样用工具返回的url。"
            "② 搜索结果不含日期,请对打算收录的每条用 fetch_page 打开原文,从正文里找发布日期,只收近 N 天内的;正文里找不到明确日期的也可收但不标假日期。③ 搜够了就直接输出最终日报的 markdown 正文(不要再解释、不加代码围栏)。"
            "⑤ 搜索结果里若带 date/source 字段(来自 Google News),说明日期和来源已可信,可直接采用,**不要对 news.google.com 开头的链接做 fetch_page**(读不了),该链接原样写进 🔗(浏览器能正常跳转到真实文章);只对非 google 的直链在需要更多细节时才 fetch。"
            "⑥ 只要 search 返回了近 N 天内、跟主题相关的真实条目,就必须写进日报,别因为'没 fetch 到正文'就丢弃或写'暂无';有 3-8 条就写 3-8 条。")
    user=(f"# 写作指令(最终输出格式)\n{writer}\n\n# 今天日期\n{today}\n\n"
          f"# 搜索方向(种子,你可自行拓展关键词)\n" + "\n".join(f"- {q}" for q in a.queries)
          + "\n\n现在开始:先多轮 web_search/fetch_page 搜集真实素材,再按格式输出日报。")
    messages=[{"role":"system","content":system},{"role":"user","content":user}]
    for step in range(a.max_steps):
        force = step==a.max_steps-1
        msg=chat(messages, tools=None if force else TOOLS)
        tcs=msg.get("tool_calls")
        if not tcs:
            content=msg.get("content","").strip()
            if content:
                if content.startswith("```"):
                    content="\n".join(l for l in content.split("\n") if not l.strip().startswith("```"))
                os.makedirs(os.path.dirname(a.out),exist_ok=True)
                tmp=a.out+".tmp"
                open(tmp,"w",encoding="utf-8").write(content.strip()+"\n")
                os.replace(tmp,a.out)   # 原子替换:旧文件一直在,直到新的写好瞬间换上,无空窗
                sys.stderr.write(f"✓ 写出 {a.out} ({len(content)}字, {step} 轮工具调用)\n"); return
            # 空内容,催一句
            messages.append({"role":"user","content":"现在直接输出最终日报markdown。"}); continue
        # 执行工具调用
        messages.append({"role":"assistant","content":msg.get("content"),"tool_calls":tcs})
        for tc in tcs:
            fn=tc["function"]["name"]
            try: args=json.loads(tc["function"]["arguments"] or "{}")
            except Exception: args={}
            if fn=="web_search":
                res=do_search(args.get("query",""), args.get("recency_days",a.recency_days))
            elif fn=="fetch_page":
                res=do_fetch(args.get("url",""))
            else: res="[未知工具]"
            sys.stderr.write(f"  [{fn}] {str(args)[:70]}\n")
            messages.append({"role":"tool","tool_call_id":tc["id"],"content":res[:6000]})
    sys.stderr.write("达到最大步数仍未产出\n"); sys.exit(4)

if __name__=="__main__":
    main()
