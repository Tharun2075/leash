import json, subprocess as sp, sys
sys.path.insert(0,'scripts'); from shots import SHOTS
FF='/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg'
L=json.load(open('lines.json')); B=json.load(open('../../brand/BRAND.lock'))['dark']
AUD=float(sp.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0','voice48.wav'],capture_output=True,text=True).stdout)
ln={l['i']:l for l in L}
# shot boundaries
bounds=[0.0]
for k in range(1,len(SHOTS)):
    prev=ln[SHOTS[k-1][1][-1]]; nxt=ln[SHOTS[k][1][0]]
    bounds.append(round((prev['end']+nxt['start'])/2,3))
bounds.append(round(AUD,3))
json.dump([[s[0],bounds[i],bounds[i+1],s[2]] for i,s in enumerate(SHOTS)],open('timing.json','w'))
# captions
def assc(h): return '&H%s%s%s&'%(h[5:7],h[3:5],h[1:3])
INK,HL=assc(B['ink']),assc(B['highlight'])
cues=[]
for l in L:
    w=l['words']; n=len(w); k=-(-n//6); size=-(-n//k); i=0
    # balanced chunks
    chunks=[]; base=n//k; extra=n%k; i=0
    for c in range(k):
        m=base+(1 if c<extra else 0); chunks.append(w[i:i+m]); i+=m
    cues+=chunks
ev=[]
def t(x):
    h=int(x//3600); m=int(x%3600//60); s=x%60; return f'{h}:{m:02d}:{s:05.2f}'
for ci,c in enumerate(cues):
    nxt_start=cues[ci+1][0][1] if ci+1<len(cues) else AUD
    cend=min(c[-1][2]+0.25,nxt_start-0.02)
    for wi,(word,ws,we) in enumerate(c):
        st=c[0][1] if wi==0 else ws
        en=c[wi+1][1] if wi+1<len(c) else cend
        txt=' '.join((f'{{\\c{HL}}}{x[0]}{{\\c{INK}}}' if j==wi else x[0]) for j,x in enumerate(c))
        ev.append(f'Dialogue: 0,{t(st)},{t(en)},Cap,,0,0,0,,{{\\an5\\pos(1920,1922)}}{txt}')
hdr=f"""[Script Info]
ScriptType: v4.00+
PlayResX: 3840
PlayResY: 2160
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Poppins,205,{INK},{INK},&H00000000&,&H00000000&,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
open('caps.ass','w').write(hdr+'\n'.join(ev)+'\n')
print('cues',len(cues),'max words',max(len(c) for c in cues))
# video
fd=0.3; N=len(SHOTS); args=[FF,'-y','-v','error']
for i,s in enumerate(SHOTS):
    d=bounds[i+1]-bounds[i]; Ld=d+(fd/2 if i in (0,N-1) else fd)
    args+=['-loop','1','-framerate','30','-t',f'{Ld:.3f}','-i',f'stills/{s[0]}.png']
args+=['-i','voice48.wav']
fl=[f'[{i}:v]format=yuv420p,setsar=1[v{i}]' for i in range(N)]; cur='v0'
for k in range(1,N):
    off=bounds[k]-fd/2; fl.append(f'[{cur}][v{k}]xfade=transition=fade:duration={fd}:offset={off:.3f}[x{k}]'); cur=f'x{k}'
fl.append(f'[{cur}]ass=caps.ass:fontsdir=.[vout]')
args+=['-filter_complex',';'.join(fl),'-map','[vout]','-map',f'{N}:a','-c:v','libx264','-preset','medium','-crf','18','-tune','stillimage','-pix_fmt','yuv420p','-r','30',
       '-c:a','aac','-b:a','192k','-t',f'{AUD:.3f}','-movflags','+faststart','../leash-demo-v3.mp4']
r=sp.run(args,capture_output=True,text=True); print(r.returncode, r.stderr[-1500:])
