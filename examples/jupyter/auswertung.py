import pandas as pd
import matplotlib.pyplot as plt
from IPython.display import display, Markdown

# Beispieldaten: später durch pd.read_csv("daten.csv") ersetzen.
daten = pd.DataFrame({
    "Monat": ["Januar", "Februar", "März", "April"],
    "Umsatz": [1200, 1550, 1420, 1880],
})
display(Markdown(f"**Gesamtumsatz:** {daten['Umsatz'].sum():,.0f} €"))
display(daten.style.format({"Umsatz": "{:,.0f} €"}).hide(axis="index"))
fig, ax = plt.subplots(figsize=(8, 4))
ax.bar(daten["Monat"], daten["Umsatz"], color="#247c86")
ax.set(title="Umsatzentwicklung", ylabel="Umsatz in Euro")
ax.spines[["top", "right"]].set_visible(False)
fig.tight_layout()
display(fig, metadata={"image/png": {"alt": "Umsatz je Monat: April hat den höchsten Umsatz."}})
plt.close("all")
