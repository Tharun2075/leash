import sys, json
from playwright.sync_api import sync_playwright
url=sys.argv[1]
with sync_playwright() as p:
    b=p.chromium.connect_over_cdp("http://127.0.0.1:49612")
    ctx=b.new_context(viewport={'width':1280,'height':900},device_scale_factor=3)
    pg=ctx.new_page(); pg.goto("https://leash-hsk.pages.dev/",wait_until='networkidle'); pg.wait_for_timeout(6000)
    out=pg.evaluate("""()=>{const r=[];for(const s of document.querySelectorAll('section, [id], .card, .panel')){const b=s.getBoundingClientRect();r.push([s.tagName,s.id,s.className,Math.round(b.x),Math.round(b.y+scrollY),Math.round(b.width),Math.round(b.height),(s.innerText||'').slice(0,80).replace(/\\n/g,' | ')])}return r}""")
    for o in out: print(o)
    print(pg.inner_text('#live') if pg.query_selector('#live') else 'no #live')
    ctx.close()
