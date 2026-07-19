#!/usr/bin/env python3
# 新闻引擎(不依赖claude,用稳定key): Firecrawl 搜真新闻+读原文 → flatkey gpt-5.5 写日报。
# 用法: flatkey-news.py --out <文件> --writer <写作指令文件> [--queries q1 q2 ...] [--recency-days 7] [--scrape N]
import os, sys, json, time, subprocess, argparse, urllib.request, urllib.error, datetime

def kc(service):
    try: return subprocess.check_output(["security","find-generic-password","-s",service,"-w"],text=True).strip()
    except Exception: return ""

FK = kc("FLATKEY_API_KEY")
FC = kc("firecrawl-api-key")
FLAT_URL = "https://router.flatkey.ai/v1/chat/completions"
MODEL = os.environ.get("FLATKEY_NEWS_MODEL","gpt-5.5")

def _post(url, payload, headers, timeout=180):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())

def fc_search(query, limit=6, recency_days=7):
    # tbs 时间限定:近7天=qdr:w,近1天=qdr:d
    tbs = "qdr:d" if recency_days<=2 else ("qdr:w" if recency_days<=7 else "qdr:m")
    try:
        d = _post("https://api.firecrawl.dev/v2/search",
                  {"query":query,"limit":limit,"tbs":tbs},
                  {"Authorization":f"Bearer {FC}","Content-Type":"application/json"}, timeout=60)
    except Exception as e:
        sys.stderr.write(f"[search err] {query}: {e}\n"); return []
    data = d.get("data",{})
    web = data.get("web",data) if isinstance(data,dict) else data
    out=[]
    for r in (web if isinstance(web,list) else []):
        out.append({"title":r.get("title",""),"url":r.get("url",""),
                    "desc":r.get("description","") or r.get("snippet",""),
                    "date":r.get("date","") or r.get("publishedDate","")})
    return out

def fc_scrape(url):
    try:
        d = _post("https://api.firecrawl.dev/v2/scrape",
                  {"url":url,"formats":["markdown"],"onlyMainContent":True},
                  {"Authorization":f"Bearer {FC}","Content-Type":"application/json"}, timeout=60)
        md = (d.get("data",{}) or {}).get("markdown","") if isinstance(d.get("data"),dict) else d.get("markdown","")
        return (md or "")[:4000]
    except Exception:
        return ""

def gpt(system, user, max_retries=2):
    payload={"model":MODEL,"messages":[{"role":"system","content":system},{"role":"user","content":user}]}
    last=""
    for i in range(max_retries):
        try:
            d=_post(FLAT_URL,payload,{"Authorization":f"Bearer {FK}","Content-Type":"application/json"},timeout=300)
            if "choices" in d: return d["choices"][0]["message"]["content"]
            last=json.dumps(d)[:300]
        except Exception as e:
            last=str(e)
        time.sleep(20)
    raise RuntimeError(f"gpt调用失败: {last}")

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--out",required=True)
    ap.add_argument("--writer",required=True, help="写作指令文件路径")
    ap.add_argument("--queries",nargs="+",required=True)
    ap.add_argument("--recency-days",type=int,default=7)
    ap.add_argument("--scrape",type=int,default=4, help="抓取前N条原文补充细节")
    ap.add_argument("--per-query",type=int,default=6)
    a=ap.parse_args()

    today=datetime.date.today().isoformat()
    # 1) 搜
    results=[]; seen=set()
    for q in a.queries:
        for r in fc_search(q, limit=a.per_query, recency_days=a.recency_days):
            if r["url"] and r["url"] not in seen:
                seen.add(r["url"]); results.append(r)
    if not results:
        sys.stderr.write("搜不到任何结果\n"); sys.exit(3)
    # 2) 抓前N条原文补充
    for r in results[:a.scrape]:
        r["fulltext"]=fc_scrape(r["url"])
    # 3) 组上下文
    ctx_lines=[]
    for i,r in enumerate(results):
        block=f"[{i+1}] 标题: {r['title']}\n链接: {r['url']}\n日期: {r['date'] or '未标注'}\n摘要: {r['desc']}"
        if r.get("fulltext"): block+=f"\n正文节选: {r['fulltext'][:1500]}"
        ctx_lines.append(block)
    context="\n\n".join(ctx_lines)
    writer=open(a.writer,encoding="utf-8").read()
    system=("你是新闻日报撰写助手。严格铁律:①只能用下面「搜索结果」里给你的事实和链接,绝对不许编造任何新闻、数字、日期或链接;"
            "链接必须原样引用给你的url,不许改造或臆造。②若某条信息搜索结果里没有,就不写。③今天日期是 "+today+"。"
            "④按用户的写作指令的格式输出,只输出markdown正文本身,不要解释、不要加代码块围栏。")
    user=f"# 写作指令\n{writer}\n\n# 今天日期\n{today}\n\n# 搜索结果(你唯一可用的事实来源)\n{context}"
    out=gpt(system,user)
    # 去掉可能的代码围栏
    out=out.strip()
    if out.startswith("```"):
        out="\n".join(l for l in out.split("\n") if not l.strip().startswith("```"))
    os.makedirs(os.path.dirname(a.out),exist_ok=True)
    tmp=a.out+".tmp"; open(tmp,"w",encoding="utf-8").write(out.strip()+"\n"); os.replace(tmp,a.out)
    sys.stderr.write(f"✓ 写出 {a.out} ({len(out)}字, 用了{len(results)}条搜索结果)\n")

if __name__=="__main__":
    main()
