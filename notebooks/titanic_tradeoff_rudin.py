"""Verifiche per l'approfondimento 01 (§1.3, argomenti 1 e 2 di Rudin 2019).

Argomento 1: confronto fra modelli interpretabili e opachi sul Titanic
(test fisso, CV 5x10 con e senza Title, differenze appaiate RF - albero d=3,
variabilità della foresta al variare degli iperparametri).
Argomento 2: dove cadono i disaccordi fra la foresta e il surrogato di profondità 3.

Esecuzione: uv run python notebooks/titanic_tradeoff_rudin.py
"""
import sys, numpy as np, warnings; warnings.filterwarnings('ignore')
sys.path.insert(0,'notebooks')
from titanic_data import load_titanic, split, Encoder
from sklearn.linear_model import LogisticRegression
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import RepeatedStratifiedKFold
df=load_titanic(); tr,te=split(df)
def models(): return {
 'regola donna': None,
 'LR': make_pipeline(StandardScaler(),LogisticRegression(max_iter=1000)),
 'albero d=2': DecisionTreeClassifier(max_depth=2,random_state=0),
 'albero d=3': DecisionTreeClassifier(max_depth=3,random_state=0),
 'albero d=4': DecisionTreeClassifier(max_depth=4,random_state=0),
 'RF': RandomForestClassifier(n_estimators=500,min_samples_leaf=3,random_state=0),
 'GBM': GradientBoostingClassifier(random_state=0)}
def evaluate(trd,ted,title=False):
  enc=Encoder().fit(trd); Xtr=enc.transform(trd,with_title=title); Xte=enc.transform(ted,with_title=title)
  ytr=trd.Survived.values; yte=ted.Survived.values; out={}
  for k,m in models().items():
    if m is None: p=Xte['Sex_female'].values
    else: p=m.fit(Xtr,ytr).predict(Xte)
    out[k]=(p==yte).mean()
  return out
print('SPLIT FISSO, n_test=',len(te))
for t in [False,True]:
  print(' title',t,{k:round(v,4) for k,v in evaluate(tr,te,t).items()})
# repeated CV
cv=RepeatedStratifiedKFold(n_splits=5,n_repeats=10,random_state=0)
for t in [False,True]:
  R={}
  for a,b in cv.split(df,df.Survived):
    for k,v in evaluate(df.iloc[a],df.iloc[b],t).items(): R.setdefault(k,[]).append(v)
  print('CV 5x10 title',t,{k:(round(np.mean(v),4),round(np.std(v),4)) for k,v in R.items()})
# tuning spread within RF
enc=Encoder().fit(tr); Xtr=enc.transform(tr); Xte=enc.transform(te)
acc=[]
for msl in [1,2,3,5,10,20]:
  for mf in ['sqrt',0.5,None]:
    for md in [None,4,8]:
      m=RandomForestClassifier(n_estimators=300,min_samples_leaf=msl,max_features=mf,max_depth=md,random_state=0).fit(Xtr,tr.Survived)
      acc.append((m.predict(Xte)==te.Survived.values).mean())
print('RF tuning: n',len(acc),'min',round(min(acc),4),'max',round(max(acc),4))

# ---- differenze appaiate e disaccordi del surrogato ----
df=load_titanic()
cv=RepeatedStratifiedKFold(n_splits=5,n_repeats=10,random_state=0); d=[]
for a,b in cv.split(df,df.Survived):
  tr,te=df.iloc[a],df.iloc[b]; e=Encoder().fit(tr); X1=e.transform(tr); X2=e.transform(te)
  rf=RandomForestClassifier(n_estimators=500,min_samples_leaf=3,random_state=0).fit(X1,tr.Survived)
  t3=DecisionTreeClassifier(max_depth=3,random_state=0).fit(X1,tr.Survived)
  y=te.Survived.values; d.append((rf.predict(X2)==y).mean()-(t3.predict(X2)==y).mean())
d=np.array(d); print('RF - d3 paired: mean',d.mean().round(4),'sd',d.std(ddof=1).round(4),'frac RF better',(d>0).mean(),'ties',(d==0).mean())
tr,te=split(df); e=Encoder().fit(tr); Xtr=e.transform(tr); Xte=e.transform(te)
rf=RandomForestClassifier(n_estimators=500,min_samples_leaf=3,random_state=0).fit(Xtr,tr.Survived)
g=DecisionTreeClassifier(max_depth=3,random_state=0).fit(Xtr,rf.predict(Xtr))
f=rf.predict(Xte); gp=g.predict(Xte); dis=f!=gp; y=te.Survived.values
grp=(te.Sex=='female').map({True:'F',False:'M'}).values+te.Pclass.astype(str).values
print('disagreements',dis.sum(),'of',len(te))
import collections; print(collections.Counter(grp[dis]), 'n F3',(grp=='F3').sum())
print('on disagreements: f correct',(f[dis]==y[dis]).sum(),'g correct',(gp[dis]==y[dis]).sum())
