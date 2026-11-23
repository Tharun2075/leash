import json, re, difflib
d=json.load(open('voice16.json'))
W=[]
for s in d['segments']:
    if s['start']>88.3: break
    for w in s.get('words',[]): W.append((w['word'].strip(),w['start'],w['end']))
sc=open('../SCRIPT.md').read()
lines=[]
for m in re.finditer(r'^\| (\d+) \| [^|]*\| (.+?) \|$',sc,re.M): lines.append(m.group(2).strip())
assert len(lines)==21,len(lines)
norm=lambda t: re.sub(r"[^a-z0-9]","",t.lower())
SW=[]  # (lineidx, word)
for i,l in enumerate(lines):
    for w in l.split(): SW.append([i,w,None,None])
a=[norm(w[1]) for w in SW]; b=[norm(w[0]) for w in W]
sm=difflib.SequenceMatcher(None,a,b,autojunk=False)
for tag,i1,i2,j1,j2 in sm.get_opcodes():
    if tag=='equal':
        for k in range(i2-i1): SW[i1+k][2]=W[j1+k][1]; SW[i1+k][3]=W[j1+k][2]
    elif tag in('replace',) and i2>i1:
        t0=W[j1][1]; t1=W[j2-1][2]; n=i2-i1
        L=[len(SW[k][1]) for k in range(i1,i2)]; tot=sum(L); c=t0
        for k in range(i1,i2):
            dd=(t1-t0)*len(SW[k][1])/tot; SW[k][2]=c; SW[k][3]=c+dd; c+=dd
        print('replace',[SW[k][1] for k in range(i1,i2)],[W[j][0] for j in range(j1,j2)])
    elif tag=='delete': print('UNMATCHED script',[SW[k][1] for k in range(i1,i2)])
    elif tag=='insert': print('extra whisper',[W[j][0] for j in range(j1,j2)])
# fill any None by neighbours
for k,w in enumerate(SW):
    if w[2] is None:
        p=SW[k-1][3]; q=next(x[2] for x in SW[k+1:] if x[2] is not None); w[2]=p; w[3]=(p+q)/2 if q>p else p+0.2
        print('filled',w)
L=[]
for i,l in enumerate(lines):
    ws=[w for w in SW if w[0]==i]; L.append({'i':i+1,'text':l,'start':ws[0][2],'end':ws[-1][3],'words':[[w[1],round(w[2],3),round(w[3],3)] for w in ws]})
    print(i+1,round(ws[0][2],2),round(ws[-1][3],2),l)
json.dump(L,open('lines.json','w'),indent=1)
