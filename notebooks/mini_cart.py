"""Un CART minimale che distingue feature ordinate e nominali.

scikit-learn fa solo split a soglia: una nominale va codificata e la codifica
decide quali raggruppamenti sono raggiungibili. Qui invece ogni feature ha un
tipo dichiarato:

- "ordered": test x <= t, con t punto medio fra valori consecutivi (k-1 candidati);
- "nominal": test x in S. Il menu completo ha 2^(k-1)-1 voci, ma per un target
  binario e il Gini basta ordinare le categorie per tasso della classe positiva
  e provare i k-1 prefissi (Breiman et al., 1984).

Valori nominali mai visti in training vanno nel ramo con piu' esempi di training
(scelta dichiarata, non appresa). Nessun valore mancante: va gestito prima.
"""

from dataclasses import dataclass, field
from itertools import count

import numpy as np
import pandas as pd


def gini(n_pos, n):
    if n == 0:
        return 0.0
    p = n_pos / n
    return 1 - p**2 - (1 - p) ** 2


@dataclass
class Split:
    feature: str
    kind: str                     # "ordered" | "nominal"
    score: float                  # Gini pesato dei figli
    threshold: float = None       # per "ordered"
    left_set: frozenset = None    # per "nominal"
    menu_full: int = 0            # voci del menu completo
    menu_evaluated: int = 0       # voci valutate davvero

    def goes_left(self, col, default_left):
        if self.kind == "ordered":
            return col.to_numpy() <= self.threshold
        seen = col.isin(self.left_set).to_numpy()
        return seen if not default_left else seen | ~col.isin(self.known).to_numpy()

    def describe(self, negate=False):
        if self.kind == "ordered":
            op = ">" if negate else "≤"
            return f"{self.feature} {op} {self.threshold:g}"
        op = "∉" if negate else "∈"
        return f"{self.feature} {op} {fmt_set(self.left_set)}"


def fmt_set(values, max_items=5):
    values = sorted(values)
    if len(values) <= max_items:
        return "{" + ", ".join(str(v) for v in values) + "}"
    head = ", ".join(str(v) for v in values[:3])
    return "{" + head + f", … ({len(values)} valori)" + "}"


@dataclass
class Node:
    id: int
    depth: int
    n: int
    n_pos: int
    split: Split = None
    default_left: bool = False
    left: "Node" = None
    right: "Node" = None

    @property
    def is_leaf(self):
        return self.split is None

    @property
    def pred(self):
        return int(self.n_pos * 2 > self.n)

    @property
    def gini(self):
        return gini(self.n_pos, self.n)


def best_ordered(x, y, min_leaf):
    order = np.argsort(x, kind="stable")
    xs, ys = x[order], y[order]
    n, P = len(ys), ys.sum()
    cum_pos = np.cumsum(ys)
    # possibili tagli: dopo la posizione i, solo se il valore cambia
    cut = np.nonzero(xs[1:] != xs[:-1])[0]
    menu = len(cut)
    cut = cut[(cut + 1 >= min_leaf) & (n - cut - 1 >= min_leaf)]
    if len(cut) == 0:
        return None, menu
    nl = cut + 1
    pl = cum_pos[cut]
    nr, pr = n - nl, P - pl
    gl = 1 - (pl / nl) ** 2 - (1 - pl / nl) ** 2
    gr = 1 - (pr / nr) ** 2 - (1 - pr / nr) ** 2
    score = nl / n * gl + nr / n * gr
    i = int(np.argmin(score))
    t = (xs[cut[i]] + xs[cut[i] + 1]) / 2
    return (float(score[i]), float(t)), menu


def best_nominal(x, y, min_leaf):
    stats = (pd.DataFrame({"x": x, "y": y}).groupby("x")["y"]
             .agg(["sum", "count"]).assign(rate=lambda d: d["sum"] / d["count"])
             .sort_values(["rate"], kind="stable"))
    k = len(stats)
    if k < 2:
        return None, 0
    n, P = len(y), y.sum()
    best = None
    nl = pl = 0
    for i in range(k - 1):
        nl += stats["count"].iloc[i]
        pl += stats["sum"].iloc[i]
        nr, pr = n - nl, P - pl
        if nl < min_leaf or nr < min_leaf:
            continue
        s = nl / n * gini(pl, nl) + nr / n * gini(pr, nr)
        if best is None or s < best[0]:
            best = (s, frozenset(stats.index[: i + 1]))
    return best, k


class MiniCART:
    def __init__(self, feature_types, max_depth=3, min_samples_leaf=5):
        self.feature_types = feature_types
        self.max_depth = max_depth
        self.min_samples_leaf = min_samples_leaf

    def fit(self, X, y):
        self._ids = count()
        self.root = self._grow(X, np.asarray(y), 0)
        return self

    def candidate_splits(self, X, y):
        """Il "menu" di ogni feature in un nodo: miglior split, voci totali, voci valutate."""
        y = np.asarray(y)
        rows = []
        for f, kind in self.feature_types.items():
            s = self._best_for(X[f], y, f, kind)
            k = X[f].nunique()
            rows.append({
                "feature": f, "tipo": kind, "valori distinti k": k,
                "menu completo": (k - 1) if kind == "ordered" else _big(2 ** (k - 1) - 1),
                "voci valutate": k - 1,
                "miglior split": s.describe() if s else "-",
                "Gini pesato": round(s.score, 4) if s else None,
            })
        return pd.DataFrame(rows)

    def _best_for(self, col, y, f, kind):
        if kind == "ordered":
            res, menu = best_ordered(col.to_numpy(dtype=float), y, self.min_samples_leaf)
            if res is None:
                return None
            return Split(f, kind, res[0], threshold=res[1], menu_full=menu, menu_evaluated=menu)
        res, k = best_nominal(col.to_numpy(), y, self.min_samples_leaf)
        if res is None:
            return None
        s = Split(f, kind, res[0], left_set=res[1], menu_full=2 ** (k - 1) - 1, menu_evaluated=k - 1)
        s.known = frozenset(col.unique())
        return s

    def _grow(self, X, y, depth):
        node = Node(next(self._ids), depth, len(y), int(y.sum()))
        if depth >= self.max_depth or node.n_pos in (0, node.n):
            return node
        candidates = [s for f, kind in self.feature_types.items()
                      if (s := self._best_for(X[f], y, f, kind)) is not None]
        if not candidates:
            return node
        split = min(candidates, key=lambda s: s.score)
        if split.score >= node.gini - 1e-12:
            return node
        mask = split.goes_left(X[split.feature], False)
        node.split = split
        node.default_left = mask.sum() >= (~mask).sum()
        node.left = self._grow(X[mask], y[mask], depth + 1)
        node.right = self._grow(X[~mask], y[~mask], depth + 1)
        return node

    # --- predizione -----------------------------------------------------------

    def leaf_of(self, X):
        out = np.empty(len(X), dtype=int)
        self._route(self.root, X, np.arange(len(X)), out)
        return out

    def _route(self, node, X, idx, out):
        if node.is_leaf:
            out[idx] = node.id
            return
        mask = node.split.goes_left(X[node.split.feature].iloc[idx], node.default_left)
        self._route(node.left, X, idx[mask], out)
        self._route(node.right, X, idx[~mask], out)

    def predict(self, X):
        leaves = {n.id: n.pred for n in self.nodes() if n.is_leaf}
        return np.array([leaves[i] for i in self.leaf_of(X)])

    def score(self, X, y):
        return float(np.mean(self.predict(X) == np.asarray(y)))

    def nodes(self):
        stack = [self.root]
        while stack:
            n = stack.pop()
            yield n
            if not n.is_leaf:
                stack += [n.right, n.left]

    # --- tre letture ----------------------------------------------------------

    def to_text(self):
        """Diagramma testuale: nodi interni, archi, foglie."""
        lines = []

        def walk(node, prefix):
            if node.is_leaf:
                return
            for child, negate, last in ((node.left, False, False), (node.right, True, True)):
                branch = "└── " if last else "├── "
                cond = node.split.describe(negate)
                if child.is_leaf:
                    lab = "SOPRAVVIVE" if child.pred else "NON SOPRAVVIVE"
                    lines.append(f"{prefix}{branch}{cond}  →  foglia {child.id}: {lab} "
                                 f"[morti {child.n - child.n_pos}, vivi {child.n_pos}]")
                else:
                    lines.append(f"{prefix}{branch}{cond}")
                walk(child, prefix + ("    " if last else "│   "))

        lines.append(f"radice [morti {self.root.n - self.root.n_pos}, vivi {self.root.n_pos}]")
        walk(self.root, "")
        return "\n".join(lines)

    def rules(self):
        """Una regola per foglia; le condizioni sulla stessa feature vengono fuse."""
        rows = []

        def walk(node, conds):
            if node.is_leaf:
                rows.append({"foglia": node.id, "regola": " AND ".join(_merge(conds)) or "(sempre)",
                             "predizione": "sopravvive" if node.pred else "non sopravvive",
                             "morti": node.n - node.n_pos, "vivi": node.n_pos,
                             "accuratezza": round(max(node.n_pos, node.n - node.n_pos) / node.n, 3)})
                return
            s = node.split
            walk(node.left, conds + [(s, True)])
            walk(node.right, conds + [(s, False)])

        walk(self.root, [])
        return pd.DataFrame(rows)


def _merge(conds):
    """Fonde le condizioni di un cammino: intervalli per le ordinate, insiemi per le nominali."""
    ordered, nominal, order = {}, {}, []
    for s, is_left in conds:
        if s.feature not in order:
            order.append(s.feature)
        if s.kind == "ordered":
            lo, hi = ordered.get(s.feature, (-np.inf, np.inf))
            ordered[s.feature] = (lo, min(hi, s.threshold)) if is_left else (max(lo, s.threshold), hi)
        else:
            allowed = nominal.get(s.feature, set(s.known))
            nominal[s.feature] = allowed & s.left_set if is_left else allowed - s.left_set
    out = []
    for f in order:
        if f in ordered:
            lo, hi = ordered[f]
            if lo == -np.inf:
                out.append(f"{f} ≤ {hi:g}")
            elif hi == np.inf:
                out.append(f"{f} > {lo:g}")
            else:
                out.append(f"{lo:g} < {f} ≤ {hi:g}")
        else:
            out.append(f"{f} ∈ {fmt_set(nominal[f])}")
    return out


def _big(n):
    return f"{n:,}".replace(",", ".") if n < 10**9 else f"≈ 10^{len(str(n)) - 1}"
