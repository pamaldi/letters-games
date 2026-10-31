"""Regole decisionali didattiche: condizioni, metriche, decision set/list, sequential covering.

Tutto e' scritto a mano (numpy + pandas) per rendere visibile ogni passaggio:

- Condition: un letterale su una feature (``x <= t``, ``x > t``, ``x == v``,
  ``x != v``, ``x in S``, ``x is missing``). Politica sui mancanti dichiarata:
  un letterale diverso da ``is missing`` e' FALSO quando il valore manca.
- Rule: congiunzione (AND) di condizioni + classe predetta.
- rule_stats: supporto, accuratezza, baseline, lift, Laplace, intervallo di Wilson.
- DecisionSet: regole senza ordine, voto (non pesato o pesato) + default.
- DecisionList: prima regola soddisfatta + default; regioni effettive E_j.
- learn_one_rule / sequential_covering: separate-and-conquer top-down greedy
  (beam search opzionale), ricetta di Molnar: si rimuovono TUTTI i casi coperti.

Non e' RIPPER (niente potatura) ne' una replica di librerie esistenti.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import log2, sqrt

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Condizioni e regole
# ---------------------------------------------------------------------------

_OPS = ("<=", ">", "==", "!=", "in", "missing")


def _fmt(v):
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, (float, np.floating)):
        return f"{v:g}"
    return str(v)


@dataclass(frozen=True)
class Condition:
    feature: str
    op: str
    value: object = None

    def __post_init__(self):
        if self.op not in _OPS:
            raise ValueError(f"operatore {self.op!r} non valido")
        if self.op == "in":
            object.__setattr__(self, "value", frozenset(self.value))

    def mask(self, df: pd.DataFrame) -> np.ndarray:
        col = df[self.feature]
        miss = col.isna().to_numpy()
        if self.op == "missing":
            return miss
        if self.op == "<=":
            m = (col <= self.value).to_numpy()
        elif self.op == ">":
            m = (col > self.value).to_numpy()
        elif self.op == "==":
            m = (col == self.value).to_numpy()
        elif self.op == "!=":
            m = (col != self.value).to_numpy()
        else:
            m = col.isin(self.value).to_numpy()
        return m & ~miss          # mancante => letterale falso (politica dichiarata)

    def __str__(self):
        if self.op == "missing":
            return f"{self.feature} mancante"
        if self.op == "in":
            return f"{self.feature} ∈ {{{', '.join(sorted(map(_fmt, self.value)))}}}"
        sym = {"<=": "≤", ">": ">", "==": "=", "!=": "≠"}[self.op]
        return f"{self.feature} {sym} {_fmt(self.value)}"


@dataclass(frozen=True)
class Rule:
    conditions: tuple = ()
    prediction: int = 1
    name: str = ""

    def covers(self, df: pd.DataFrame) -> np.ndarray:
        m = np.ones(len(df), dtype=bool)        # antecedente vuoto: copre tutto
        for c in self.conditions:
            m &= c.mask(df)
        return m

    def extend(self, cond: Condition) -> "Rule":
        return Rule(self.conditions + (cond,), self.prediction, self.name)

    @property
    def length(self) -> int:
        return len(self.conditions)

    def antecedent(self) -> str:
        return " AND ".join(map(str, simplify(self.conditions))) or "(vero)"

    def __str__(self):
        label = f"{self.name}: " if self.name else ""
        return f"{label}IF {self.antecedent()} THEN y = {self.prediction}"


def simplify(conditions) -> list:
    """Fonde le condizioni sulla stessa feature: intervalli per <=/>, insiemi per ==/!=/in.

    Serve solo per la stampa; la semantica resta quella della congiunzione.
    """
    out, by_feat = [], {}
    for c in conditions:
        by_feat.setdefault(c.feature, []).append(c)
    for feat, cs in by_feat.items():
        lo = max((c.value for c in cs if c.op == ">"), default=None)
        hi = min((c.value for c in cs if c.op == "<="), default=None)
        if lo is not None and hi is not None:
            out.append(_Interval(feat, lo, hi))
        else:
            out += [c for c in cs if c.op in ("<=", ">") and c.value in (lo, hi)]
        eq = [c for c in cs if c.op == "=="]
        neq = [c for c in cs if c.op == "!="]
        ins = [c for c in cs if c.op == "in"]
        if eq:
            out.append(eq[0])
        elif neq and not ins:
            out += neq if len(neq) == 1 else [_NotIn(feat, frozenset(c.value for c in neq))]
        elif ins:
            s = frozenset.intersection(*(c.value for c in ins)) - {c.value for c in neq}
            out.append(Condition(feat, "in", s))
        out += [c for c in cs if c.op == "missing"]
    return out


@dataclass(frozen=True)
class _Interval:
    feature: str
    lo: float
    hi: float

    def __str__(self):
        return f"{_fmt(self.lo)} < {self.feature} ≤ {_fmt(self.hi)}"


@dataclass(frozen=True)
class _NotIn:
    feature: str
    values: frozenset

    def __str__(self):
        return f"{self.feature} ∉ {{{', '.join(sorted(map(_fmt, self.values)))}}}"


# ---------------------------------------------------------------------------
# Metriche di una singola regola
# ---------------------------------------------------------------------------


def wilson(k: int, n: int, z: float = 1.96):
    """Intervallo di Wilson al 95% per una proporzione k/n."""
    if n == 0:
        return (np.nan, np.nan)
    p = k / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (centre - half, centre + half)


def rule_stats(rule: Rule, df: pd.DataFrame, y) -> dict:
    y = np.asarray(y)
    cov = rule.covers(df)
    n, n_cov = len(y), int(cov.sum())
    correct = int((y[cov] == rule.prediction).sum())
    base = float((y == rule.prediction).mean())
    acc = correct / n_cov if n_cov else np.nan
    lo, hi = wilson(correct, n_cov)
    return {
        "regola": rule.name or rule.antecedent(),
        "antecedente": rule.antecedent(),
        "predice": rule.prediction,
        "lunghezza": rule.length,
        "coperti": n_cov,
        "corretti": correct,
        "supporto": n_cov / n,
        "accuratezza": acc,
        "baseline": base,                       # frequenza della classe predetta
        "lift": acc / base if n_cov else np.nan,
        "laplace": (correct + 1) / (n_cov + 2),
        "wilson_lo": lo,
        "wilson_hi": hi,
        "recall_classe": correct / max(int((y == rule.prediction).sum()), 1),
    }


def rules_table(rules, df, y) -> pd.DataFrame:
    return pd.DataFrame([rule_stats(r, df, y) for r in rules])


# ---------------------------------------------------------------------------
# Decision set e decision list
# ---------------------------------------------------------------------------


def coverage_matrix(rules, df) -> np.ndarray:
    """Matrice n x m: True se la regola j copre il caso i."""
    return np.column_stack([r.covers(df) for r in rules]) if rules else np.zeros((len(df), 0), bool)


@dataclass
class DecisionSet:
    """Regole non ordinate. weights: None (voto semplice) o un peso per regola.

    Parita' -> tie_class. Nessuna regola attiva -> default. Le due situazioni
    sono tenute distinte (``status``).
    """

    rules: list
    default: int
    weights: list | None = None
    tie_class: int | None = None

    def votes(self, df):
        C = coverage_matrix(self.rules, df)
        w = np.ones(len(self.rules)) if self.weights is None else np.asarray(self.weights, float)
        preds = np.array([r.prediction for r in self.rules])
        v1 = (C * w * (preds == 1)).sum(axis=1)
        v0 = (C * w * (preds == 0)).sum(axis=1)
        return C, v0, v1

    def predict(self, df) -> np.ndarray:
        return self.predict_with_status(df)[0]

    def predict_with_status(self, df):
        C, v0, v1 = self.votes(df)
        tie = self.default if self.tie_class is None else self.tie_class
        out = np.where(v1 > v0, 1, np.where(v0 > v1, 0, tie))
        n_active = C.sum(axis=1)
        out = np.where(n_active == 0, self.default, out)
        preds = np.array([r.prediction for r in self.rules])
        disagree = np.array([len(set(preds[row])) > 1 for row in C])
        status = np.select(
            [n_active == 0, disagree & (v0 == v1), disagree, n_active > 1],
            ["default", "conflitto: parità", "conflitto: voto", "più regole concordi"],
            "una regola",
        )
        return out, status


@dataclass
class DecisionList:
    rules: list
    default: int

    def fired(self, df) -> np.ndarray:
        """Indice della prima regola soddisfatta (0..m-1), oppure m = default."""
        C = coverage_matrix(self.rules, df)
        any_ = C.any(axis=1)
        first = np.where(any_, C.argmax(axis=1), len(self.rules))
        return first

    def predict(self, df) -> np.ndarray:
        preds = np.array([r.prediction for r in self.rules] + [self.default])
        return preds[self.fired(df)]

    def regions(self, df, y) -> pd.DataFrame:
        """Regioni effettive E_j: chi viene deciso da ciascuna regola (e dal default)."""
        y = np.asarray(y)
        f = self.fired(df)
        rows = []
        for j, r in enumerate(self.rules + [None]):
            sel = f == j
            pred = self.default if r is None else r.prediction
            cov_raw = int(r.covers(df).sum()) if r is not None else int(sel.sum())
            rows.append({
                "posizione": j + 1 if r is not None else "default",
                "regola": "ELSE" if r is None else str(r).split(": ", 1)[-1],
                "copre (da sola)": cov_raw,
                "decide (E_j)": int(sel.sum()),
                "corretti": int((y[sel] == pred).sum()),
                "acc. effettiva": (y[sel] == pred).mean() if sel.any() else np.nan,
            })
        return pd.DataFrame(rows)

    def explain(self, row: pd.DataFrame) -> str:
        """Spiegazione locale: regola usata + negazione delle precedenti."""
        j = int(self.fired(row)[0])
        prev = [f"NOT({r.antecedent()})" for r in self.rules[:j]]
        if j == len(self.rules):
            return "nessuna regola: default y = %d  [%s]" % (self.default, " AND ".join(prev))
        used = self.rules[j]
        why = f"regola {j + 1}: {used.antecedent()} → y = {used.prediction}"
        return why + (f"   perché prima: {' AND '.join(prev)}" if prev else "")

    def __str__(self):
        lines = [("IF " if j == 0 else "ELSE IF ") + f"{r.antecedent()} THEN y = {r.prediction}"
                 for j, r in enumerate(self.rules)]
        return "\n".join(lines + [f"ELSE y = {self.default}"])


# ---------------------------------------------------------------------------
# Candidati e apprendimento
# ---------------------------------------------------------------------------


def candidate_conditions(df: pd.DataFrame, feature_types: dict, n_cuts: int = 6) -> list:
    """Letterali ammessi. ordered: <= t e > t sui quantili; nominal: == v e != v.

    Le feature ordinate sono discretizzate IN ANTICIPO (quantili del training):
    la ricerca delle regole vede solo questi punti di taglio. Se la colonna ha
    mancanti si aggiunge il letterale ``is missing``.
    """
    cands = []
    for f, t in feature_types.items():
        col = df[f].dropna()
        if t == "ordered":
            vals = np.sort(col.unique())
            if len(vals) <= n_cuts + 1:
                cuts = (vals[:-1] + vals[1:]) / 2
            else:
                qs = np.unique(np.quantile(col, np.linspace(0, 1, n_cuts + 2)[1:-1]))
                cuts = [q for q in qs if col.min() <= q < col.max()]
            for c in cuts:
                c = float(np.round(c, 2))
                cands += [Condition(f, "<=", c), Condition(f, ">", c)]
        elif t == "nominal":
            vals = sorted(col.unique(), key=str)
            for v in vals:
                cands.append(Condition(f, "==", v))
                if len(vals) > 2:
                    cands.append(Condition(f, "!=", v))
        else:
            raise ValueError(f"tipo {t!r} sconosciuto per {f}")
        if df[f].isna().any():
            cands.append(Condition(f, "missing"))
    return cands


def score_rule(pos: int, neg: int, criterion: str, pos0: int = 0, neg0: int = 0) -> float:
    """pos/neg = casi coperti della classe predetta / delle altre."""
    n = pos + neg
    if n == 0:
        return -np.inf
    if criterion == "accuracy":
        return pos / n
    if criterion == "laplace":
        return (pos + 1) / (n + 2)
    if criterion == "foil":      # guadagno rispetto alla regola padre (pos0, neg0)
        if pos == 0 or pos0 == 0:
            return -np.inf
        return pos * (log2(pos / n) - log2(pos0 / (pos0 + neg0)))
    raise ValueError(criterion)


@dataclass
class SearchStep:
    passo: int
    regola: str
    coperti: int
    positivi: int
    accuratezza: float
    punteggio: float


def learn_one_rule(df, y, target, candidates, criterion="laplace", min_covered=10,
                   max_len=3, beam_width=1, return_trace=False):
    """Ricerca top-down: si parte dall'antecedente vuoto e si aggiungono letterali.

    beam_width=1 e' hill climbing greedy; >1 conserva i migliori k candidati
    a ogni profondita'. Si restituisce la regola migliore vista (non
    necessariamente la piu' lunga). Vincolo: almeno ``min_covered`` casi coperti.
    """
    y = np.asarray(y)
    is_pos = y == target
    cand_masks = [c.mask(df) for c in candidates]

    def evaluate(mask, parent):
        p, n = int((mask & is_pos).sum()), int((mask & ~is_pos).sum())
        if criterion == "foil":
            return score_rule(p, n, "foil", *parent), p, n
        return score_rule(p, n, criterion), p, n

    root_mask = np.ones(len(y), bool)
    root_p = int(is_pos.sum())
    beam = [(Rule((), target), root_mask, (root_p, len(y) - root_p))]
    best, best_score, trace = None, -np.inf, []
    for depth in range(1, max_len + 1):
        pool = []
        for rule, mask, parent in beam:
            used = {(c.feature, c.op, c.value) for c in rule.conditions}
            for c, cm in zip(candidates, cand_masks):
                if (c.feature, c.op, c.value) in used:
                    continue
                m = mask & cm
                if m.sum() < min_covered or m.sum() == mask.sum():
                    continue                           # troppo piccola o letterale inutile
                s, p, n = evaluate(m, parent)
                pool.append((s, p, n, rule.extend(c), m))
        if not pool:
            break
        pool.sort(key=lambda t: (-t[0], -(t[1] + t[2]), str(t[3])))
        top = pool[:beam_width]
        s, p, n, r, m = top[0]
        trace.append(SearchStep(depth, r.antecedent(), p + n, p, p / (p + n), s))
        # con FOIL il punteggio e' relativo al padre: per scegliere la migliore
        # regola complessiva usiamo sempre Laplace (confrontabile fra profondita')
        global_s = score_rule(p, n, "laplace") if criterion == "foil" else s
        if global_s > best_score + 1e-12:
            best, best_score = r, global_s
        elif beam_width == 1:
            break                                      # nessun miglioramento: stop
        beam = [(r_, m_, (p_, n_)) for _, p_, n_, r_, m_ in top]
    return (best, trace) if return_trace else best


@dataclass
class CoveringStep:
    passo: int
    regola: str
    residuo_prima: int
    coperti: int
    corretti: int
    accuratezza: float
    residuo_dopo: int


def sequential_covering(df, y, target=1, feature_types=None, candidates=None,
                        criterion="laplace", min_covered=10, min_accuracy=0.6,
                        max_len=3, max_rules=10, beam_width=1, remove="covered",
                        return_trace=False):
    """Separate-and-conquer per la classe ``target`` (ricetta binaria di Molnar).

    Ciclo esterno: impara una regola sul residuo, la accetta se supera
    ``min_accuracy`` (sul residuo), rimuove i casi coperti e ripete.
    remove="covered" (Molnar) toglie tutti i coperti; remove="correct" toglie
    solo quelli classificati bene: variante didattica che rompe la coerenza
    con la semantica della lista. Default = classe piu' frequente nel residuo.
    """
    y = pd.Series(np.asarray(y), index=df.index)
    if candidates is None:
        candidates = candidate_conditions(df, feature_types)
    rest_X, rest_y = df, y
    rules, trace = [], []
    for k in range(1, max_rules + 1):
        if len(rest_y) == 0 or (rest_y == target).sum() == 0:
            break
        r = learn_one_rule(rest_X, rest_y, target, candidates, criterion, min_covered,
                           max_len, beam_width)
        if r is None:
            break
        cov = r.covers(rest_X)
        corr = int((rest_y[cov] == target).sum())
        acc = corr / cov.sum()
        if acc < min_accuracy:
            break
        r = Rule(r.conditions, target, f"R{k}")
        rules.append(r)
        drop = cov if remove == "covered" else cov & (rest_y.to_numpy() == target)
        trace.append(CoveringStep(k, r.antecedent(), len(rest_y), int(cov.sum()), corr, acc,
                                  int(len(rest_y) - drop.sum())))
        rest_X, rest_y = rest_X[~drop], rest_y[~drop]
    default = int(rest_y.mode().iloc[0]) if len(rest_y) else int(y.mode().iloc[0])
    model = DecisionList(rules, default)
    return (model, pd.DataFrame([vars(t) for t in trace])) if return_trace else model


# ---------------------------------------------------------------------------
# Autoverifica sugli esempi degli appunti
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Le 10 case degli appunti (§5.2): supporto 4/10, accuratezza 3/4
    case = pd.DataFrame({"sup": [120, 150, 110, 130, 90, 140, 80, 200, 60, 105],
                         "giardino": ["sì", "sì", "sì", "sì", "sì", "no", "no", "no", "sì", "no"]})
    yv = np.array([1, 1, 0, 1, 0, 1, 0, 1, 0, 0])
    r = Rule((Condition("sup", ">", 100), Condition("giardino", "==", "sì")), 1)
    st = rule_stats(r, case, yv)
    assert (st["coperti"], st["corretti"]) == (4, 3) and st["supporto"] == 0.4

    # Gli otto casi del §6.4: due liste con stessa accuracy 6/8, decisioni diverse
    d = pd.DataFrame({"reddito": [40, 35, 20, 20, 45, 50, 15, 25],
                      "debito": [25, 10, 25, 10, 30, 5, 22, 8]})
    y8 = np.array([0, 1, 0, 1, 1, 1, 0, 0])
    R1 = Rule((Condition("reddito", ">", 29.5),), 1, "R1")
    R2 = Rule((Condition("debito", ">", 19.5),), 0, "R2")
    a, b = DecisionList([R1, R2], 0).predict(d), DecisionList([R2, R1], 0).predict(d)
    assert (a == y8).sum() == (b == y8).sum() == 6
    assert list(np.flatnonzero(a != b) + 1) == [1, 5]
    print("autoverifica ok")
