import sys, json
from playwright.sync_api import sync_playwright
T={'tx_blocked':'0xd89d291a4b6f396993f6d42b00a23a03f424ce82f6c75fe29016f838873259f5',
   'tx_allowed':'0x8335626dfe4ac434027c5b2e8d0c3823f4a039553f9883b34daa4dbe8030f456',
   'tx_approve':'0xe694e2d55f1a840404844128e9c8cf798bf00f59f7fcc367d13726df5891cc06'}
JS="""(stopWords)=>{
 const h=document.querySelector('h1').getBoundingClientRect();
 let bottom=1e9;
 for(const e of document.querySelectorAll('div,span,p')){ if(e.children.length) continue; const t=(e.innerText||'').trim();
   if(stopWords.includes(t)){const r=e.getBoundingClientRect(); if(r.top>h.bottom && r.top<bottom) bottom=r.top;}}
 let right=0;
 for(const e of document.querySelectorAll('*')){ if(e.children.length) continue; const r=e.getBoundingClientRect();
   if(((e.innerText||"").trim()||["path","IMG","circle","rect"].includes(e.tagName)) && r.width>0 && r.width<900 && r.top>=h.top-2 && r.bottom<=bottom && r.right<1380) right=Math.max(right,r.right);}
 let tb=0; for(const e of document.querySelectorAll('div,span')){ if(e.children.length) continue; if((e.innerText||'').trim()==='Timestamp'){tb=e.getBoundingClientRect().bottom;} }
 for(const e of document.querySelectorAll('body *')){ const r0=e.getBoundingClientRect(); if(r0.bottom<=h.top-1 && r0.height<120 && r0.height>0) e.style.visibility='hidden'; }
 for(const e of document.querySelectorAll('div')){ const t=(e.innerText||'').trim(); const r=e.getBoundingClientRect(); if(t.startsWith('Sponsored:') && r.bottom<h.top+2 && r.height<80) e.style.visibility='hidden'; }
 return {x:h.left-36,y:h.top+scrollY-36,width:right-h.left+72,height:tb-h.top+40+8};
}"""
with sync_playwright() as p:
    b=p.chromium.connect_over_cdp("http://127.0.0.1:49612")
    ctx=b.new_context(viewport={'width':1400,'height':1000},device_scale_factor=3)
    for name,tx in T.items():
        pg=ctx.new_page(); pg.goto('https://hsk.blockscout.com/tx/'+tx,wait_until='domcontentloaded'); pg.wait_for_timeout(9000)
        c=pg.evaluate(JS,['Sponsored','From'])
        print(name,c)
        pg.screenshot(path=f'real/{name}.png',clip=c,full_page=True)
        pg.screenshot(path=f'real/{name}_full1x.png',full_page=True,scale='css')
        pg.close()
    ctx.close()
