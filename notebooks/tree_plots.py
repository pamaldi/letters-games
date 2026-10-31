"""Figure per le tre letture di un MiniCART: diagramma e partizione dello spazio."""

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.patches import Patch, Rectangle

DIED, SURVIVED = "#c0504d", "#4f81bd"


def plot_tree(model, ax=None, title=None):
    """Diagramma nodo-arco-foglia. Ramo sinistro = condizione vera."""
    leaves = []

    def layout(node, depth):
        if node.is_leaf:
            pos[node.id] = (len(leaves), -depth)
            leaves.append(node)
            return
        layout(node.left, depth + 1)
        layout(node.right, depth + 1)
        pos[node.id] = ((pos[node.left.id][0] + pos[node.right.id][0]) / 2, -depth)

    pos = {}
    layout(model.root, 0)
    if ax is None:
        _, ax = plt.subplots(figsize=(max(8, 1.9 * len(leaves)), 1.9 * (1 - min(p[1] for p in pos.values()))))
    for node in model.nodes():
        x, y = pos[node.id]
        if node.is_leaf:
            color = SURVIVED if node.pred else DIED
            text = (f"foglia {node.id}\n{'SOPRAVVIVE' if node.pred else 'NON SOPRAVV.'}\n"
                    f"morti {node.n - node.n_pos} · vivi {node.n_pos}")
            ax.text(x, y, text, ha="center", va="center", fontsize=8, color="white",
                    bbox=dict(boxstyle="round,pad=0.4", fc=color, ec="none"))
            continue
        ax.text(x, y, node.split.describe(), ha="center", va="center", fontsize=9,
                bbox=dict(boxstyle="round,pad=0.4", fc="#f2f2f2", ec="#555"))
        for child, lab in ((node.left, "sì"), (node.right, "no")):
            cx, cy = pos[child.id]
            ax.annotate("", xy=(cx, cy + 0.22), xytext=(x, y - 0.22),
                        arrowprops=dict(arrowstyle="-|>", color="#555", lw=1))
            ax.text((x + cx) / 2, (y + cy) / 2, lab, fontsize=8, ha="center",
                    bbox=dict(fc="white", ec="none", pad=0.5))
    xs = [p[0] for p in pos.values()]
    ys = [p[1] for p in pos.values()]
    ax.set_xlim(min(xs) - 0.7, max(xs) + 0.7)
    ax.set_ylim(min(ys) - 0.6, 0.6)
    ax.axis("off")
    if title:
        ax.set_title(title)
    return ax


def plot_partition_age_pclass(model, data, titles, age_max=80):
    """Una colonna per valore di Title; in ciascuna il piano (Age, Pclass).

    Age e' continua: i tagli sono rette verticali in qualsiasi punto.
    Pclass e' ordinale: i dati stanno su tre righe, i tagli cadono fra una riga e l'altra.
    Title e' nominale: non c'e' un asse, ogni valore ha il suo pannello; pannelli
    che finiscono nello stesso sottoinsieme hanno la stessa partizione.
    """
    ages = np.linspace(0, age_max, 801)
    fig, axes = plt.subplots(1, len(titles), figsize=(3.4 * len(titles), 3.6), sharey=True)
    preds = {n.id: n.pred for n in model.nodes() if n.is_leaf}
    for ax, t in zip(axes, titles):
        for pclass in (1, 2, 3):
            grid = pd.DataFrame({"Age": ages, "Pclass": pclass, "Title": t})
            leaf = model.leaf_of(grid)
            # segmenti contigui con la stessa foglia = intervalli di Age
            starts = np.r_[0, np.nonzero(np.diff(leaf))[0] + 1]
            ends = np.r_[starts[1:], len(ages)]
            for s, e in zip(starts, ends):
                x0, x1 = ages[s], ages[min(e, len(ages) - 1)]
                color = SURVIVED if preds[leaf[s]] else DIED
                ax.add_patch(Rectangle((x0, pclass - 0.45), x1 - x0, 0.9, fc=color, alpha=0.18, ec="none"))
                # bordo: separa anche foglie confinanti con la stessa classe
                ax.add_patch(Rectangle((x0, pclass - 0.45), x1 - x0, 0.9, fc="none", ec="#333", lw=0.9))
                ax.text((x0 + x1) / 2, pclass + 0.32, f"f{leaf[s]}", ha="center", fontsize=7, color="#333")
        pts = data[data["Title"] == t]
        jitter = np.random.default_rng(0).uniform(-0.28, 0.28, len(pts))
        ax.scatter(pts["Age"], pts["Pclass"] + jitter, s=9,
                   c=np.where(pts["Survived"] == 1, SURVIVED, DIED), alpha=0.85, lw=0)
        ax.set_title(f"Title = {t}  (n={len(pts)})", fontsize=10)
        ax.set_xlim(0, age_max)
        ax.set_xlabel("Age (continua)")
        ax.grid(False)
    axes[0].set_yticks([1, 2, 3])
    axes[0].set_ylim(3.6, 0.4)
    axes[0].set_ylabel("Pclass (ordinale)")
    fig.legend(handles=[Patch(fc=DIED, alpha=0.4, label="regione predetta: non sopravvive"),
                        Patch(fc=SURVIVED, alpha=0.4, label="regione predetta: sopravvive")],
               loc="lower center", ncol=2, frameon=False, bbox_to_anchor=(0.5, -0.06))
    fig.tight_layout()
    return fig


def plot_id_barcode(model, train, test, feature="PassengerId"):
    """Partizione lungo l'asse dell'identificativo: un codice a barre."""
    fig, ax = plt.subplots(figsize=(12, 2.4))
    leaf_tr = model.leaf_of(train)
    preds = {n.id: n.pred for n in model.nodes() if n.is_leaf}
    colors = [SURVIVED if preds[l] else DIED for l in leaf_tr]
    ax.vlines(train[feature], 0.55, 1.45, colors=colors, lw=0.9)
    leaf_te = model.leaf_of(test)
    colors_te = [SURVIVED if preds[l] else DIED for l in leaf_te]
    ax.vlines(test[feature], -0.45, 0.45, colors=colors_te, lw=0.9)
    ax.set_yticks([1, 0])
    ax.set_yticklabels(["training", "test (ID mai visti)"])
    ax.set_xlabel(feature)
    ax.set_xlim(0, max(train[feature].max(), test[feature].max()) + 10)
    ax.set_title("Regione assegnata a ciascun ID (colore = classe predetta)", fontsize=10)
    fig.tight_layout()
    return fig
