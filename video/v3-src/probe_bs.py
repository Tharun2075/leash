import sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.connect_over_cdp("http://127.0.0.1:49612")
    ctx=b.new_context(viewport={'width':1400,'height':1000},device_scale_factor=1)
    pg=ctx.new_page(); pg.goto(sys.argv[1],wait_until='domcontentloaded'); pg.wait_for_timeout(9000)
    pg.screenshot(path=sys.argv[2],full_page=True)
    print(pg.evaluate("""()=>{const r=[];for(const e of document.querySelectorAll('h1,[data-testid]')){const b=e.getBoundingClientRect();r.push([e.tagName,e.getAttribute('data-testid'),Math.round(b.x),Math.round(b.y+scrollY),Math.round(b.width),Math.round(b.height),(e.innerText||'').slice(0,70).replace(/\\n/g,' | ')])}return r.slice(0,80)}"""))
    ctx.close()
