import random
R=random.Random(2)
def power(N,w,crit,trials=20000):
    E=N/6;h=0
    for _ in range(trials):
        c=[0]*6
        for x in R.choices(range(6),weights=w,k=N): c[x]+=1
        S=sum((x-E)**2 for x in c)  # hand: sum of squared deviations
        if S/E>=crit: h+=1
    return h/trials
for N in (60,120):
  for crit in (11.07,15.09):
    print(N,crit,'S>=%.0f'%(crit*N/6),'FA',power(N,[1]*6,crit),'dbl',power(N,[2,1,1,1,1,1],crit),'+50',power(N,[1.5,1,1,1,1,1],crit))
