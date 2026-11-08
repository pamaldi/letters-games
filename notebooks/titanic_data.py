"""Caricamento e preparazione del Titanic, condivisi dai notebook di approfondimento.

Una sola fonte per dataset, feature derivate, split e codifica numerica, così che
tutti i notebook (introduzione, valutazione, bias/fairness) lavorino sugli stessi
623 passeggeri di training e 268 di test.

Scelte dichiarate:
- `Title` è estratto dal nome (Mr, Mrs, Miss, Master, Other);
- `FamilySize = SibSp + Parch + 1`;
- split stratificato 70/30 con `random_state=0` (lo stesso della nota sulle regole);
- la codifica numerica calcola mediana dell'età e moda del porto **sul solo training**
  e aggiunge l'indicatore `Age_missing`, così il test non entra nella preparazione.
"""

from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

DATA = Path(__file__).resolve().parent.parent / "data" / "titanic.csv"
DIED, SURVIVED = "#c0504d", "#4f81bd"

NUMERIC_FEATURES = ["Pclass", "Sex_female", "Age", "Age_missing", "SibSp", "Parch",
                    "Fare", "Embarked_C", "Embarked_Q"]


def load_titanic(path=DATA):
    """Legge il CSV e aggiunge `Title` e `FamilySize`."""
    df = pd.read_csv(path)
    title = df["Name"].str.extract(r",\s*([^.]+)\.")[0].str.strip()
    df["Title"] = title.where(title.isin(["Mr", "Mrs", "Miss", "Master"]), "Other")
    df["FamilySize"] = df["SibSp"] + df["Parch"] + 1
    return df


def split(df, test_size=0.3, seed=0):
    """Split stratificato sul target: restituisce (train, test) come DataFrame interi."""
    tr, te = train_test_split(df, test_size=test_size, stratify=df["Survived"], random_state=seed)
    return tr.copy(), te.copy()


class Encoder:
    """Codifica numerica con statistiche stimate sul training (fit) e applicate altrove."""

    def fit(self, train):
        self.age_median = float(train["Age"].median())
        self.port_mode = train["Embarked"].mode()[0]
        return self

    def transform(self, df, with_title=False):
        X = pd.DataFrame(index=df.index)
        X["Pclass"] = df["Pclass"]
        X["Sex_female"] = (df["Sex"] == "female").astype(int)
        X["Age"] = df["Age"].fillna(self.age_median)
        X["Age_missing"] = df["Age"].isna().astype(int)
        X["SibSp"] = df["SibSp"]
        X["Parch"] = df["Parch"]
        X["Fare"] = df["Fare"]
        port = df["Embarked"].fillna(self.port_mode)
        X["Embarked_C"] = (port == "C").astype(int)
        X["Embarked_Q"] = (port == "Q").astype(int)
        if with_title:
            for t in ["Mrs", "Miss", "Master", "Other"]:
                X[f"Title_{t}"] = (df["Title"] == t).astype(int)
        return X


def feature_table(df):
    """Tabella descrittiva delle feature: tipo, valori, mancanti, tasso di sopravvivenza."""
    rows = []
    for col, kind in [("Pclass", "ordinale"), ("Sex", "nominale binaria"), ("Age", "continua"),
                      ("SibSp", "conteggio"), ("Parch", "conteggio"), ("Fare", "continua"),
                      ("Embarked", "nominale"), ("Title", "nominale (derivata)"),
                      ("FamilySize", "conteggio (derivata)")]:
        s = df[col]
        if s.dtype.kind in "if" and s.nunique() > 10:
            values = f"{s.min():g}–{s.max():g}, mediana {s.median():g}"
        else:
            values = ", ".join(map(str, sorted(s.dropna().unique())))
        rows.append({"feature": col, "tipo": kind, "valori": values, "mancanti": int(s.isna().sum())})
    return pd.DataFrame(rows)


def rate_by(df, col):
    """Passeggeri, sopravvissuti e tasso per valore di una colonna (mancanti inclusi)."""
    g = df.assign(**{col: df[col].astype(object).where(df[col].notna(), "mancante")})
    out = g.groupby(col)["Survived"].agg(passeggeri="size", sopravvissuti="sum")
    out["tasso"] = (out["sopravvissuti"] / out["passeggeri"]).round(3)
    return out


def group_metrics(y, yhat, groups):
    """Matrice di confusione e metriche di fairness per gruppo (classe positiva = 1)."""
    rows = {}
    for g in pd.unique(groups):
        m = groups == g
        yt, yp = np.asarray(y)[m], np.asarray(yhat)[m]
        tp = int(((yt == 1) & (yp == 1)).sum()); fn = int(((yt == 1) & (yp == 0)).sum())
        fp = int(((yt == 0) & (yp == 1)).sum()); tn = int(((yt == 0) & (yp == 0)).sum())
        n = tp + fn + fp + tn
        rows[g] = {"N": n, "TP": tp, "FN": fn, "FP": fp, "TN": tn,
                   "base rate": (tp + fn) / n, "SR": (tp + fp) / n,
                   "TPR": tp / (tp + fn) if tp + fn else np.nan,
                   "FPR": fp / (fp + tn) if fp + tn else np.nan,
                   "PPV": tp / (tp + fp) if tp + fp else np.nan,
                   "Accuracy": (tp + tn) / n}
    return pd.DataFrame(rows).T
