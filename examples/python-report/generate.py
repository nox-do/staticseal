"""Create an HTML report with separate CSS and PNG resources."""
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from jinja2 import Environment, FileSystemLoader, select_autoescape

root = Path(__file__).resolve().parent
months = ['Januar', 'Februar', 'März', 'April']
revenue = [1200, 1550, 1420, 1880]

plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11})
fig, ax = plt.subplots(figsize=(7.8, 3.3), facecolor='#fffefa')
ax.set_facecolor('#fffefa')
ax.bar(months, revenue, width=0.56, color=['#709883'] * 3 + ['#b85e3f'], zorder=3)
for index, value in enumerate(revenue):
    ax.text(index, value + 55, f'{value:,}'.replace(',', '.') + ' €', ha='center', color='#203e39')
ax.set_ylim(0, 2250)
ax.set_yticks([0, 1000, 2000], ['0', '1.000', '2.000'])
ax.tick_params(axis='both', length=0, labelcolor='#617368', pad=10)
ax.spines[['top', 'right', 'left', 'bottom']].set_visible(False)
ax.grid(axis='y', color='#e3e8df', zorder=0)
fig.tight_layout(pad=1.5)
fig.savefig(root / 'umsatz.png', dpi=150, metadata={'Software': 'Matplotlib'})
plt.close(fig)

env = Environment(loader=FileSystemLoader(root), autoescape=select_autoescape(['html', 'j2']))
html = env.get_template('bericht.html.j2').render(
    total=f'{sum(revenue):,}'.replace(',', '.'),
    peak=f'{max(revenue):,}'.replace(',', '.'),
    growth=f'{(revenue[-1] / revenue[0] - 1) * 100:.1f}'.replace('.', ','),
)
(root / 'bericht.html').write_text(html + '\n', encoding='utf-8')
print('Created bericht.html + bericht.css + umsatz.png')
