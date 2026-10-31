"""Smoke test: addestra un modello per famiglia di metodi XAI su breast cancer."""

import warnings

import pandas as pd
import shap
from gosdt import GOSDTClassifier
from interpret.glassbox import ExplainableBoostingClassifier
from lime.lime_tabular import LimeTabularExplainer
from rulefit import RuleFit
from sklearn.datasets import load_breast_cancer
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split

warnings.filterwarnings("ignore")

X, y = load_breast_cancer(return_X_y=True, as_frame=True)
X_tr, X_te, y_tr, y_te = train_test_split(X, y, random_state=0)

# glass-box: EBM
ebm = ExplainableBoostingClassifier(random_state=0).fit(X_tr, y_tr)
print(f"EBM accuracy:     {ebm.score(X_te, y_te):.3f}")

# regole: RuleFit
rf_rules = RuleFit(rfmode="classify", max_rules=50, max_iter=100, random_state=0).fit(X_tr.values, y_tr.values, feature_names=list(X.columns))
n_rules = len(rf_rules.rule_ensemble.rules)
n_active = (rf_rules.coef_[-n_rules:] != 0).sum()
print(f"RuleFit regole attive: {n_active}/{n_rules}")

# albero ottimo: GOSDT (su feature binarizzate)
X_bin = (X_tr[["mean radius", "mean texture", "worst area"]] > X_tr[["mean radius", "mean texture", "worst area"]].median()).astype(int)
gosdt = GOSDTClassifier(regularization=0.01).fit(X_bin, y_tr)
print(f"GOSDT train accuracy: {gosdt.score(X_bin, y_tr):.3f}")

# post-hoc: SHAP + LIME su random forest
rf = RandomForestClassifier(n_estimators=100, random_state=0).fit(X_tr, y_tr)
sv = shap.TreeExplainer(rf)(X_te.iloc[:20])
print(f"SHAP values shape: {sv.values.shape}")
lime_exp = LimeTabularExplainer(X_tr.values, feature_names=list(X.columns), class_names=["malignant", "benign"])
exp = lime_exp.explain_instance(X_te.values[0], rf.predict_proba, num_features=3)
print("LIME top-3:", pd.DataFrame(exp.as_list(), columns=["feature", "peso"]).to_dict("records"))
