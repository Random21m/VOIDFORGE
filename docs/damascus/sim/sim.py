import random, math
from math import comb
R=random.Random(1)
def roll(w): return R.choices(range(6),weights=w)[0]
def facecheck(N,w,T,L,trials=20000):
    hit=0
    for _ in range(trials):
        c=[0]*6
        for _ in range(N): c[roll(w)]+=1
        if max(c)>=T or min(c)<=L: hit+=1
    return hit/trials
fair=[1]*6; dbl=[2,1,1,1,1,1]; p50=[1.5,1,1,1,1,1]; dead=[0,1,1,1,1,1]
for N,T,L in [(60,21,1),(60,20,2),(66,22,2),(120,33,8),(120,32,9),(132,35,9)]:
    print(N,T,L,'FA',facecheck(N,fair,T,L),'dbl',facecheck(N,dbl,T,L),'+50',facecheck(N,p50,T,L),'dead',facecheck(N,dead,T,L,2000))
# binomial ones count per 26
p=sum(comb(26,k) for k in range(0,6))/2**26
print('P(ones<=5 or >=21 in 26)',2*p)
# same-suit neighbours in random deck
def ss():
    d=[(s) for s in range(4) for r in range(13)]
    R.shuffle(d); return sum(d[i]==d[i+1] for i in range(51))
xs=[ss() for _ in range(20000)]
print('samesuit mean',sum(xs)/len(xs),'P>=20',sum(x>=20 for x in xs)/len(xs),'P>=18',sum(x>=18 for x in xs)/len(xs))
# entropy of 5-bit symbol from 6x6 table (reject doubles 1-1..4-4) with biased die
def symdist(w):
    s=sum(w); p=[x/s for x in w]
    cells=[(a,b) for a in range(6) for b in range(6) if not (a==b and a<4)]
    pr=[p[a]*p[b] for a,b in cells]; t=sum(pr); pr=[x/t for x in pr]
    H=-sum(x*math.log2(x) for x in pr if x>0); Hmin=-math.log2(max(pr))
    return H,Hmin,pr
for name,w in [('fair',fair),('+50%',p50),('double',dbl),('dead face',dead)]:
    H,Hm,pr=symdist(w); print(name,'H/sym %.3f Hmin/sym %.3f -> 26 syms Hmin %.1f'%(H,Hm,26*Hm))
# XOR of biased dice symbol with uniform-ish? XOR of two biased sources: dice (double) and cards bits w/ bias eps
def xor_dist(p1,p2):
    out=[0]*32
    for i,a in enumerate(p1):
        for j,b in enumerate(p2): out[i^j]+=a*b
    return out
_,_,pd=symdist(dbl)
q=[ (0.6 if (k&1)==0 else 0.4)/16 for k in range(32)]  # card bits with one bit biased 60/40
o=xor_dist(pd,q); print('XOR dbl-die x biased-card: Hmin/sym %.4f (max 5)'%(-math.log2(max(o))))
# rates/time
for bits in (128,256):
    syms=math.ceil(bits/5); print(bits,'bits: symbols',syms,'expected pair rolls %.1f'%(syms*36/32),'card decks (26 bits each)',math.ceil(bits/26))
