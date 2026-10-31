"""Verifica rapida che tutte le librerie XAI siano importabili."""

import importlib

LIBS = [
    "numpy", "pandas", "scipy", "sklearn", "matplotlib", "seaborn",
    "fairlearn", "imodels", "rulefit", "gosdt", "interpret", "h2o",
    "shap", "lime", "dice_ml",
]


def main():
    for name in LIBS:
        try:
            mod = importlib.import_module(name)
            print(f"OK   {name:<12} {getattr(mod, '__version__', '')}")
        except Exception as exc:
            print(f"FAIL {name:<12} {exc!r}")


if __name__ == "__main__":
    main()
