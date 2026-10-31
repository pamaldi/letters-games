# xai-experiments

Esperimenti ed esempi per il cookbook di **Interpretable ML / Explainable AI** (UniFi 2025-2026).
Il materiale del corso è in `../xai-2025-2026-cookbook`.

## Setup

Richiede [uv](https://docs.astral.sh/uv/) e Java (solo per `h2o`).

```bash
uv sync
uv run main.py                 # verifica che tutte le librerie si importino
uv run scripts/smoke_test.py   # addestra EBM, RuleFit, GOSDT, SHAP, LIME su breast cancer
```

## PyCharm

1. *File → Open* sulla cartella `xai-experiments`.
2. *Settings → Project → Python Interpreter → Add Interpreter → Add Local Interpreter*
   → tipo **uv** → *Select existing* → `.venv\Scripts\python.exe`.
   (Se PyCharm propone da solo l'interprete `.venv` di uv, basta accettarlo.)
3. Per i notebook in `notebooks/` il kernel è lo stesso interprete (`ipykernel` è nel gruppo `dev`).

Per aggiungere una libreria: `uv add <pacchetto>` (non `pip install`), così `pyproject.toml` e `uv.lock` restano allineati.

## Struttura

```
notebooks/   notebook Jupyter
scripts/     script Python (smoke_test.py)
data/        dataset locali (es. COMPAS da ProPublica)
main.py      check degli import
```

## Esempi

| Notebook | Contenuto |
|---|---|
| `notebooks/titanic_albero_tipi_feature.ipynb` | Alberi sul Titanic con una feature per tipo (continua `Age`, ordinale `Pclass`, nominale `Title`, identificativo `PassengerId`), letti come diagramma, regole e partizione. Usa `mini_cart.py` (CART con split su sottoinsiemi per le nominali) e `tree_plots.py`. Dati: `data/titanic.csv` (copia del CSV di Data Science Dojo usato nel corso). |
| `notebooks/titanic_regole.ipynb` | Regole decisionali sul Titanic: supporto, accuratezza, baseline/lift, Laplace e Wilson; decision set (voto, pesi, spareggio) e decision list (ordine, regioni effettive); nota sulla linearità della lavagna; sequential covering con criteri accuratezza/Laplace/FOIL, rimozione dei coperti, stabilità su 30 split. Usa `rule_learning.py` (solo numpy/pandas; `uv run notebooks/rule_learning.py` esegue l'autoverifica). |

## Librerie

| Area | Pacchetti |
|---|---|
| Base | numpy, pandas, scipy, scikit-learn, matplotlib, seaborn |
| Bias & fairness | fairlearn |
| Interpretability by design | imodels, rulefit (git), gosdt, interpret (EBM), h2o |
| Post-hoc | shap, lime, dice-ml |

## Note di compatibilità

- **scikit-learn è fissato a 1.7.x**: `gosdt` 1.0.4 usa `check_array(force_all_finite=...)`
  (rimosso in 1.8) e `rulefit` usa `LassoCV(n_alphas=...)` (rimosso in 1.9).
- **rulefit** viene da GitHub (come nel notebook `02_RuleFit`). Passare sempre `max_iter=100`
  al costruttore, altrimenti `LogisticRegressionCV` riceve `max_iter=None` ed esplode.
  Questa versione non ha `get_rules()`: le regole sono in `model.rule_ensemble.rules`.
- **corels** non è incluso: non ha wheel per Windows e la build richiede un compilatore C e GMP.
  Per gli esperimenti con CORELS conviene usare WSL.
