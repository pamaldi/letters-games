"""Verifiche per l'approfondimento 01 (§1.2): robustezza contro causalità.

Robustezza: quante predizioni della random forest cambiano con piccole perturbazioni
casuali di età (±1, ±2, ±5 anni; 20 ripetizioni) e prezzo (±5%, ±10%).
Causalità: intervento che assegna ai passeggeri di terza classe il prezzo mediano
di un biglietto di prima classe (mediana sul training).

Esecuzione: uv run python notebooks/titanic_robustezza_causalita.py
"""
import sys, numpy as np, warnings; warnings.filterwarnings('ignore'); sys.path.insert(0,'notebooks')
from titanic_data import load_titanic, split, Encoder
from sklearn.ensemble import RandomForestClassifier
df=load_titanic(); tr,te=split(df); e=Encoder().fit(tr); Xtr=e.transform(tr); Xte=e.transform(te)
rf=RandomForestClassifier(n_estimators=500,min_samples_leaf=3,random_state=0).fit(Xtr,tr.Survived)
p0=rf.predict(Xte); pr0=rf.predict_proba(Xte)[:,1]
rng=np.random.default_rng(0)
for d in [1,2,5]:
  fl=[]
  for r in range(20):
    X=Xte.copy(); m=X.Age_missing==0
    X.loc[m,'Age']=(X.loc[m,'Age']+rng.uniform(-d,d,m.sum())).clip(0.4)
    fl.append((rf.predict(X)!=p0).mean())
  print('age +-',d,'flip mean',round(np.mean(fl),4),'max',round(max(fl),4))
for frac in [0.05,0.10]:
  X=Xte.copy(); X['Fare']=X.Fare*(1+rng.uniform(-frac,frac,len(X))); print('fare +-',frac,'flip',round((rf.predict(X)!=p0).mean(),4))
m3=(Xte.Pclass==3).values
f1=tr.loc[tr.Pclass==1,'Fare'].median(); print('median fare 1st (train)',f1, 'median 3rd', tr.loc[tr.Pclass==3,'Fare'].median())
X=Xte.copy(); X.loc[m3,'Fare']=f1
pr1=rf.predict_proba(X)[:,1]; p1=rf.predict(X)
print('3rd class n',m3.sum(),'mean p before',round(pr0[m3].mean(),3),'after',round(pr1[m3].mean(),3),'pred survive before',p0[m3].sum(),'after',p1[m3].sum())
fem=(Xte.Sex_female==1).values
for g,mm in [('F3',m3&fem),('M3',m3&~fem)]:
  print(g,mm.sum(),round(pr0[mm].mean(),3),round(pr1[mm].mean(),3),p0[mm].sum(),p1[mm].sum())
