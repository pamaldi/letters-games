"""Crescita didattica CART/C4.5 semplificata, senza dipendenze esterne.

Dati completi, classificazione, niente pruning. C4.5 omette in particolare
le correzioni sulle soglie e il trattamento frazionario dei mancanti.
Eseguire dalla radice: python notebooks/decision_tree_didattico.py
"""

from collections import Counter
from itertools import combinations
from math import isclose, isfinite, log2


def impurity(y, kind):
    p = [n / len(y) for n in Counter(y).values()]
    return 1 - sum(q * q for q in p) if kind == "gini" else -sum(q * log2(q) for q in p)


def candidates(X, j, feature_type, method):
    values = sorted({row[j] for row in X})
    if feature_type == "ordered":
        for a, b in zip(values, values[1:]):
            yield ("threshold", j, a + (b - a) / 2)
    elif len(values) > 1:
        if method == "c45":
            yield ("multi", j, tuple(values))
        else:
            # Fissare la prima categoria a sinistra evita duplicati speculari.
            for size in range(len(values) - 1):
                for extra in combinations(values[1:], size):
                    yield ("subset", j, frozenset((values[0], *extra)))


def branch(test, row):
    kind, j, value = test
    if kind == "threshold":
        return row[j] <= value
    if kind == "subset":
        return row[j] in value
    return row[j]


def partition(test, X):
    groups = {}
    for i, row in enumerate(X):
        groups.setdefault(branch(test, row), []).append(i)
    return groups


def fit(X, y, types, method="cart", max_depth=3, min_leaf=1):
    """Tipi: 'ordered' (numeri finiti), 'nominal' (stringhe).

    Ordine di generazione per gli spareggi fra test; prima classe incontrata
    per gli spareggi di maggioranza. Una categoria nuova usa il nodo corrente.
    """
    if method not in ("cart", "c45"):
        raise ValueError("method deve essere cart o c45")
    if not X or len(X) != len(y) or any(len(row) != len(types) for row in X):
        raise ValueError("X e y devono essere non vuoti e avere dimensioni coerenti")
    if max_depth < 0 or min_leaf < 1 or any(t not in ("ordered", "nominal") for t in types):
        raise ValueError("Tipi o limiti di crescita non validi")
    for row in X:
        for value, feature_type in zip(row, types):
            valid = (isinstance(value, (int, float)) and isfinite(value)) if feature_type == "ordered" else isinstance(value, str)
            if not valid:
                raise ValueError("Servono numeri finiti per ordered e stringhe per nominal")

    kind = "gini" if method == "cart" else "entropy"

    def grow(rows, labels, depth):
        node = {"prediction": Counter(labels).most_common(1)[0][0], "n": len(labels)}
        if len(set(labels)) == 1 or depth >= max_depth:
            return node
        parent = impurity(labels, kind)
        feature_best = []
        for j, feature_type in enumerate(types):
            options = []
            for test in candidates(rows, j, feature_type, method):
                groups = partition(test, rows)
                if len(groups) < 2 or min(map(len, groups.values())) < min_leaf:
                    continue
                weights = [len(indices) / len(labels) for indices in groups.values()]
                after = sum(w * impurity([labels[i] for i in indices], kind)
                            for w, indices in zip(weights, groups.values()))
                gain = parent - after
                split_info = -sum(w * log2(w) for w in weights)
                options.append((gain, gain / split_info, test, groups))
            if options:
                # Un candidato per feature: massimo gain (semplificazione C4.5).
                feature_best.append(max(options, key=lambda option: option[0]))
        if not feature_best:
            return node
        if method == "c45":
            average = sum(option[0] for option in feature_best) / len(feature_best)
            eligible = [option for option in feature_best if option[0] >= average - 1e-12]
            best = max(eligible, key=lambda option: option[1])
        else:
            best = max(feature_best, key=lambda option: option[0])
        gain, _, test, groups = best
        if gain <= 1e-12:
            return node
        if types[test[1]] == "nominal":
            node["known_categories"] = frozenset(row[test[1]] for row in rows)
        node.update(test=test, gain=gain, children={
            key: grow([rows[i] for i in indices], [labels[i] for i in indices], depth + 1)
            for key, indices in groups.items()
        })
        return node

    return grow(X, y, 0)


def predict(tree, row):
    while "test" in tree:
        if "known_categories" in tree and row[tree["test"][1]] not in tree["known_categories"]:
            break
        key = branch(tree["test"], row)
        if key not in tree["children"]:
            break  # Categoria mai vista: fallback dichiarato, non C4.5 storico.
        tree = tree["children"][key]
    return tree["prediction"]


def show(tree, indent=""):
    if "test" not in tree:
        print(f"{indent}foglia: classe={tree['prediction']}, n={tree['n']}")
        return
    kind, j, value = tree["test"]
    question = (f"x{j} <= {value:g}?" if kind == "threshold" else
                f"x{j} in {sorted(value)}?" if kind == "subset" else f"valore di x{j}?")
    print(f"{indent}{question} (gain={tree['gain']:.6f}, n={tree['n']})")
    for key, child in tree["children"].items():
        print(f"{indent}  esito={key}")
        show(child, indent + "    ")


def main():
    parent = [1] * 50 + [0] * 50
    left, right = [1] * 5 + [0] * 35, [1] * 45 + [0] * 15
    g_after = .4 * impurity(left, "gini") + .6 * impurity(right, "gini")
    h_after = .4 * impurity(left, "entropy") + .6 * impurity(right, "entropy")
    ig = impurity(parent, "entropy") - h_after
    si = -.4 * log2(.4) - .6 * log2(.6)
    assert isclose(g_after, .3125) and isclose(.5 - g_after, .1875)
    assert isclose(ig, .2958073480446817)
    assert isclose(ig / si, .304657, abs_tol=1e-6)
    print(f"Lavagna: Gini split={g_after:.6f}, IG={ig:.6f}, GR={ig / si:.6f}")

    X, y = [(1, "A"), (2, "B"), (3, "A"), (4, "B")], [0, 0, 1, 1]
    for method in ("cart", "c45"):
        tree = fit(X, y, ["ordered", "nominal"], method=method)
        assert tree["test"] == ("threshold", 0, 2.5)
        assert [predict(tree, row) for row in X] == y
        assert predict(tree, (2.2, "A")) == 0
        print(f"\n{method.upper()} sul dataset delle soglie:")
        show(tree)

    for threshold in (1.5, 2.5, 3.5):
        groups = partition(("threshold", 0, threshold), X)
        after = {kind: sum(len(indices) / 4 * impurity([y[i] for i in indices], kind)
                           for indices in groups.values()) for kind in ("gini", "entropy")}
        assert isclose(after["gini"], 0 if threshold == 2.5 else 1 / 3)
        assert isclose(1 - after["entropy"], 1 if threshold == 2.5 else .31127812445913283)

    # Due coppie di categorie: CART può raggrupparle in un solo test.
    Xcat, ycat = [(v,) for v in "AABBCCDD"], [0, 0, 0, 0, 1, 1, 1, 1]
    assert len(list(candidates(Xcat, 0, "nominal", "cart"))) == 7
    for method, children in (("cart", 2), ("c45", 4)):
        tree = fit(Xcat, ycat, ["nominal"], method=method)
        assert len(tree["children"]) == children
        assert [predict(tree, row) for row in Xcat] == ycat
        assert predict(tree, ("nuova",)) == tree["prediction"]
        print(f"\n{method.upper()} sulle categorie:")
        show(tree)

    xor = [(0, 0), (0, 1), (1, 0), (1, 1)]
    for method in ("cart", "c45"):
        assert "test" not in fit(xor, [0, 1, 1, 0], ["ordered"] * 2, method=method)
    print("\nVerificati: conti, soglie, categorie, fallback e arresto su XOR.")


if __name__ == "__main__":
    main()
