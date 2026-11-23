from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.connect_over_cdp("http://127.0.0.1:49612")
    ctx=b.new_context(viewport={'width':1280,'height':900},device_scale_factor=3,locale='en-US')
    pg=ctx.new_page(); pg.goto("https://leash-hsk.pages.dev/",wait_until='networkidle'); pg.wait_for_timeout(7000)
    pg.evaluate("(()=>{const a=document.querySelector('#amt'); a.type='text'; a.value='9.00';})()")
    import sys
    if len(sys.argv)>1: pg.set_viewport_size({'width':int(sys.argv[1]),'height':900}); pg.wait_for_timeout(1500)
    for sel,name in ([('#receipt','site_receipt')] if len(sys.argv)>1 else [('#budget-panel','site_budget'),('#decoder','site_decoder'),('#receipt','site_receipt')]):
        r=pg.evaluate(f"(()=>{{const b=document.querySelector('{sel}').getBoundingClientRect();return {{x:b.x,y:b.y+scrollY,w:b.width,h:b.height}}}})()")
        pg.add_style_tag(content=f'body *{{visibility:hidden !important}} {sel}, {sel} *{{visibility:visible !important}}')
        P=min(36,r['x']); pg.screenshot(path=f'real/{name}.png',full_page=True,clip={'x':r['x']-P,'y':r['y']-P,'width':r['w']+2*P,'height':r['h']+2*P})
        print(name,r); pg.evaluate('document.querySelectorAll("style").forEach(s=>{if(s.textContent.includes("visibility:hidden !important"))s.remove()})')
    print(pg.inner_text('#decoder'))
    ctx.close()
