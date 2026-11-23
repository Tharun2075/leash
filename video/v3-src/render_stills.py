import json, os, sys
sys.path.insert(0,'scripts'); from shots import SHOTS
from playwright.sync_api import sync_playwright
J=os.getcwd()
C=json.load(open('../../brand/BRAND.lock'))['dark']
CSS=f"""
@font-face{{font-family:Geist;src:url(geist-sans-latin-400-normal.woff2);font-weight:400}}
@font-face{{font-family:Geist;src:url(geist-sans-latin-600-normal.woff2);font-weight:600}}
@font-face{{font-family:'Geist Mono';src:url(geist-mono-latin-400-normal.woff2)}}
@font-face{{font-family:'Instrument Serif';src:url(instrument-serif-latin-400-normal.woff2)}}
@font-face{{font-family:Poppins;src:url(Poppins-Bold.ttf);font-weight:700}}
:root{{--bg:{C['bg']};--surface:{C['surface']};--ink:{C['ink']};--muted:{C['muted']};--line:{C['line']};--accent:{C['accent']};--tint:{C['tint']};--hl:{C['highlight']};--ok:{C['success']};--warn:{C['warn']};--err:{C['error']}}}
*{{box-sizing:border-box;margin:0;padding:0}}
html,body{{width:1920px;height:1080px;overflow:hidden}}
body{{background:linear-gradient(135deg,var(--tint) 0%,var(--bg) 62%);font-family:Geist;color:var(--ink)}}
.panel{{position:absolute;left:120px;top:34px;width:1680px;height:840px;border-radius:18px;border:3px solid var(--accent);
 box-shadow:0 24px 60px rgba(0,0,0,.45);overflow:hidden;display:flex;align-items:center;justify-content:center}}
.card{{background:var(--surface)}}
.inner{{width:1440px}}
.tag{{position:absolute;left:120px;top:1030px;display:flex;align-items:center;gap:18px;font-family:Poppins;font-weight:700;font-size:30px;letter-spacing:9px;color:var(--accent)}}
.tag i{{display:block;width:46px;height:5px;border-radius:3px;background:var(--accent)}}
.real{{position:absolute;right:120px;top:1032px;font-family:Geist;font-weight:600;font-size:24px;color:var(--muted);display:flex;align-items:center;gap:12px}}
.real b{{color:var(--hl);letter-spacing:3px;font-weight:600}}
.real s{{display:block;width:12px;height:12px;border-radius:50%;background:var(--hl);text-decoration:none}}
.eyebrow{{font-family:Geist;font-weight:600;font-size:30px;letter-spacing:4px;text-transform:uppercase;color:var(--accent)}}
.serif{{font-family:'Instrument Serif';font-weight:400;line-height:1.08;color:var(--ink)}}
.body{{font-size:44px;line-height:1.4;color:var(--muted)}}
.pill{{white-space:nowrap;display:inline-flex;align-items:center;border:3px solid var(--line);border-radius:999px;padding:22px 44px;font-size:52px;font-weight:600;color:var(--ink)}}
.mono{{font-family:'Geist Mono'}}
.num{{display:flex;align-items:center;justify-content:center;width:120px;height:120px;border-radius:50%;background:var(--accent);color:var(--bg);font-family:'Instrument Serif';font-size:84px}}
.badge{{display:inline-block;border:3px solid var(--warn);color:var(--warn);border-radius:999px;padding:14px 34px;font-size:40px;font-weight:600}}
"""
CARDS={
'hook':"""<div class=inner><div class=eyebrow>HSK Chain Horizon Hackathon Seoul · Track 2: Agent Payments</div>
<div class=serif style="font-size:300px;margin-top:30px">Leash</div></div>""",
'headline':"""<div class=inner><div class="serif" style="font-size:122px">Give each AI agent a budget it cannot overspend, enforced on HSK mainnet.</div></div>""",
'pills':"""<div class=inner style="display:flex;flex-direction:column;gap:44px;align-items:flex-start">
<div class=pill>HSK Chain mainnet · chain 177</div>
<div class=pill style="border-color:var(--ok);color:var(--ok)">✓ Contract source verified on Blockscout</div>
<div class=pill><span>PolicyVault&nbsp;</span><span class=mono style="font-weight:400">0x7360…13a9</span></div></div>""",
'step1':"""<div class=inner style="display:flex;gap:70px;align-items:flex-start"><div class=num style="flex:none">1</div><div>
<div class=serif style="font-size:120px">Owner sets the budget</div>
<div class=body style="font-size:56px;margin-top:36px;color:var(--ink)">50 USD a day, 5 USD max per payment, listed shops, cooldown. Only the owner.</div></div></div>""",
'diff1':"""<div class=inner><div class=eyebrow>What is different</div>
<div class=serif style="font-size:112px;margin-top:28px">A budget per agent, on mainnet</div>
<div class=body style="margin-top:40px;font-size:50px">Daily cap, per-payment max, shop list and cooldown live in a verified contract on HSK mainnet, not in a demo server or on testnet.</div></div>""",
'step2':"""<div class=inner style="display:flex;gap:70px;align-items:flex-start"><div class=num style="flex:none">2</div><div>
<div class=serif style="font-size:120px">Agent asks first</div>
<div class=body style="font-size:56px;margin-top:36px;color:var(--ink)">Every payment starts with <span class=mono style="color:var(--accent)">requestPayment</span> on the mainnet contract.</div></div></div>""",
'stats':"""<div class=inner style="display:flex;flex-direction:column;gap:70px">
<div style="display:flex;align-items:baseline;justify-content:space-between;border-bottom:3px solid var(--line);padding-bottom:40px"><div class=eyebrow style="color:var(--muted);font-size:40px">Daily allowance</div><div class=mono style="font-size:150px;white-space:nowrap;color:var(--ink)">50.00 USD</div></div>
<div style="display:flex;align-items:baseline;justify-content:space-between"><div class=eyebrow style="color:var(--muted);font-size:40px">Max per payment</div><div class=mono style="font-size:150px;white-space:nowrap;color:var(--accent)">5.00 USD</div></div></div>""",
'verdict':"""<div class=inner><div class=eyebrow>Why blocked? Ask the contract</div>
<div style="margin-top:40px;border:4px solid var(--err);border-radius:28px;padding:56px 64px">
<div style="font-size:76px;font-weight:600;line-height:1.3;color:var(--err)">Blocked: 9.00 USD is above the per-payment limit of 5.00 USD.</div>
<div class=mono style="font-size:56px;margin-top:30px;color:var(--ink)">(reason 4 OVER_PER_PAYMENT)</div></div></div>""",
'decoded':"""<div class=inner><div class=eyebrow>Decoded by Blockscout · tx 0xd89d…59f5</div>
<div style="margin-top:44px;display:flex;flex-direction:column;gap:36px">
<div style="border:3px solid var(--line);border-radius:24px;padding:40px 52px"><div class=body style="font-size:36px">Input</div>
<div class=mono style="font-size:54px;margin-top:14px">requestPayment · amount <span style="color:var(--hl)">9000000</span></div></div>
<div style="border:3px solid var(--err);border-radius:24px;padding:40px 52px"><div class=body style="font-size:36px">Revert reason</div>
<div class=mono style="font-size:54px;margin-top:14px;color:var(--err)">PolicyBlocked(uint8 reason) · reason <span style="color:var(--hl)">4</span></div></div></div></div>""",
'hsp':"""<div class=inner><div class=badge>HSP mock (QA access pending)</div>
<div class=serif style="font-size:150px;margin-top:40px">Paying through HSP</div>
<div class=body style="margin-top:34px;font-size:52px"><b style="color:var(--ink);font-weight:600">Budget first.</b> <span class=mono style="color:var(--accent)">requestPayment</span> on the vault. Blocked payments never reach HSP.</div></div>""",
'hspsteps':"""<div class=inner style="display:flex;flex-direction:column;gap:46px">
<div style="display:flex;gap:44px"><div class=num style="flex:none;width:90px;height:90px;font-size:62px">2</div><div class=body style="font-size:42px"><b style="color:var(--ink);font-weight:600">Prepare.</b> <span class=mono style="color:var(--accent)">create_order</span> → <span class=mono style="color:var(--accent)">prepare_payment</span> returns an EIP-712 payment mandate.</div></div>
<div style="display:flex;gap:44px"><div class=num style="flex:none;width:90px;height:90px;font-size:62px">3</div><div class=body style="font-size:42px"><b style="color:var(--ink);font-weight:600">Check before signing.</b> Leash compares the EIP-712 data with the purchase: chain id, token, recipient = listed shop, value = the budget-checked amount. Any mismatch refuses.</div></div>
<div style="display:flex;gap:44px"><div class=num style="flex:none;width:90px;height:90px;font-size:62px">4</div><div class=body style="font-size:42px"><b style="color:var(--ink);font-weight:600">One human approval.</b> The owner approves a card built from that checked message and signs in their own wallet; the vault records <span class=mono style="color:var(--accent)">approve</span>.</div></div></div>""",
'mock':"""<div class=inner><div class=badge style="font-size:64px;padding:22px 52px;border-width:4px">HSP mock (QA access pending)</div>
<div class=body style="margin-top:56px;font-size:56px;color:var(--ink)">HashKey's HSP QA gateway has not allowlisted us yet. Until it does, the HSP steps run against a mock that follows the documented shapes and checks real signatures.</div></div>""",
'hashes':"""<div class=inner><div class=eyebrow>Latest signed receipt · intent #2 · chain 177</div>
<div style="margin-top:44px;font-size:84px;font-weight:600;line-height:1.25;color:var(--ink)"><span style="color:var(--ok)">✓</span> All 4 receipt hashes match <span class=mono style="color:var(--hl);font-weight:400">getReceipt(2)</span> on mainnet right now.</div>
<div class=body style="margin-top:44px;font-size:46px"><b style="color:var(--ink);font-weight:600">Receipt.</b> <span class=mono style="color:var(--accent)">settle</span> stores hashes of flow_id, payment_request_id, the policy and the HSP tx on chain.</div></div>""",
'close':"""<div class=inner><div class=serif style="font-size:260px">Leash</div>
<div class=serif style="font-size:84px;margin-top:10px;color:var(--muted)">Give each AI agent a budget it cannot overspend, enforced on HSK mainnet.</div>
<div style="margin-top:56px;display:flex;gap:28px"><div class=pill style="font-size:36px;padding:16px 32px">HSK Chain mainnet · chain 177</div><div class=pill style="font-size:36px;padding:16px 32px;border-color:var(--ok);color:var(--ok)">✓ Contract source verified on Blockscout</div></div></div>""",
}
def page(sid,kind,payload):
    if kind=='card':
        body=f'<div class="panel card">{CARDS[payload]}</div>'; lab=''
    else:
        img,label=payload
        from PIL import Image
        im=Image.open(f'real/{img}.png'); px=im.getpixel((4,4))[:3]; bgc='#%02x%02x%02x'%px
        body=f'<div class=panel style="background:{bgc};padding:44px"><img src="real/{img}.png" style="max-width:100%;max-height:100%;object-fit:contain"></div>'
        lab=f'<div class=real><s></s><b>REAL PAGE</b>&nbsp;{label}</div>'
    return f'<!doctype html><html><head><meta charset=utf-8><style>{CSS}</style></head><body>{body}<div class=tag><i></i>LEASH</div>{lab}</body></html>'
only=sys.argv[1:]
with sync_playwright() as p:
    b=p.chromium.connect_over_cdp(os.environ['CDP'])
    ctx=b.new_context(viewport={'width':1920,'height':1080},device_scale_factor=2)
    pg=ctx.new_page()
    for sid,lines,kind,payload in SHOTS:
        if only and sid not in only: continue
        open(f'{sid}.html','w').write(page(sid,kind,payload))
        pg.goto('file://'+J+f'/{sid}.html'); pg.evaluate('document.fonts.ready'); pg.wait_for_timeout(400)
        # overflow check: inner content fits panel with 24px margin
        ok=pg.evaluate("""()=>{const p=document.querySelector('.panel').getBoundingClientRect();const e=document.querySelector('.panel > *').getBoundingClientRect();return [Math.round(e.top-p.top),Math.round(p.bottom-e.bottom),Math.round(e.left-p.left),Math.round(p.right-e.right)]}""")
        pg.screenshot(path=f'stills/{sid}.png'); print(sid,kind,'margins t/b/l/r',ok)
    ctx.close()
