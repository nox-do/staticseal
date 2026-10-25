"""Rebuild the two one-page samples: python3 -m pip install reportlab && python3 generate.py."""
from pathlib import Path
import reportlab
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4

fonts = Path(reportlab.__file__).parent / 'fonts'
pdfmetrics.registerFont(TTFont('Briefing', str(fonts / 'Vera.ttf')))
pdfmetrics.registerFont(TTFont('Briefing-Bold', str(fonts / 'VeraBd.ttf')))

output = Path(__file__).with_name('brief.pdf')
c = canvas.Canvas(str(output), pagesize=A4, invariant=1)
c.setTitle('Nordlicht - Entscheidungsbrief')
c.setAuthor('Staticseal - Fiktives Beratungsbeispiel')
w, h = A4
ink = '#203e39'
muted = '#617368'

def text(x, y, value, size=11, font='Briefing', color=ink):
    c.setFillColor(HexColor(color))
    c.setFont(font, size)
    c.drawString(x, y, value)

def rect(x, y, width, height, color, radius=0):
    c.setFillColor(HexColor(color))
    c.roundRect(x, y, width, height, radius, fill=1, stroke=0)

rect(0, 0, w, h, '#f5f2e9')
rect(0, h - 10, w, 10, '#b85e3f')
text(48, 784, 'NORDLICHT / BERATUNG', 10, 'Briefing-Bold')
text(48, 741, 'ENTSCHEIDUNGSBRIEF', 9, 'Briefing-Bold', '#b85e3f')
text(48, 688, 'Weniger Übergaben.', 30, 'Briefing')
text(48, 646, 'Mehr Zeit für den Kunden.', 30, 'Briefing')
text(48, 610, 'Auftragseingang vereinfachen - Empfehlung für einen Piloten.', 11, color=muted)

rect(48, 458, w - 96, 116, ink, 12)
text(68, 545, 'POTENZIAL PRO MONAT', 9, 'Briefing-Bold', '#c8d9cc')
text(68, 495, '26,7 Stunden', 33, 'Briefing', '#fffefa')
text(311, 528, '200 Fälle pro Monat', 11, color='#fffefa')
text(311, 506, '8 Minuten weniger je Fall', 11, color='#fffefa')
text(311, 484, '30 auf 22 Minuten', 10, color='#c8d9cc')

text(48, 420, '01 / Empfehlung', 13, 'Briefing-Bold')
text(48, 397, 'Einen klaren Ablauf mit vollständigen Eingaben und einer')
text(48, 380, 'verantwortlichen Ansprechperson testen. Rückfragen bündeln,')
text(48, 363, 'bevor zusätzliche Automatisierung eingeführt wird.')

text(48, 321, '02 / Annahmen', 13, 'Briefing-Bold')
text(48, 298, 'Heute: 30 Minuten je Fall. Klarer Ablauf: 22 Minuten je Fall.')
text(48, 281, 'Rechnung: (30 - 22) × 200 ÷ 60 = 26,7 Stunden pro Monat.')
text(48, 264, 'Modellrechnung ohne Einführungsaufwand und Kosten. Kein Forecast.')

text(48, 222, '03 / Nächster Schritt', 13, 'Briefing-Bold')
text(48, 199, 'Den Ablauf zwei Wochen in einem kleinen Team erproben.')
text(48, 182, 'Bearbeitungszeit und Rückfragen vor und nach dem Piloten messen.')
text(48, 165, 'Danach den Nutzen bewerten und über die Ausweitung entscheiden.')

rect(48, 88, w - 96, 42, '#e9edde', 6)
text(62, 105, 'Fiktive Beispieldaten. Dieses Dokument enthält keine Kundeninformationen.', 9, color=muted)
rect(48, 66, w - 96, 1, '#d7ded2')
text(48, 46, 'Staticseal / Beispiel für die Ergebnisübergabe', 9, color=muted)
text(w - 80, 46, '01 / 01', 9, color=muted)
c.showPage()
c.save()
print(output)

# Companion document for the two-PDF handoff example.
output = Path(__file__).with_name('plan.pdf')
c = canvas.Canvas(str(output), pagesize=A4, invariant=1)
c.setTitle('Nordlicht - Pilotplan')
c.setAuthor('Staticseal - Fiktives Beratungsbeispiel')
rect(0, 0, w, h, '#f5f2e9')
rect(0, h - 10, w, 10, '#285f4e')
text(48, 784, 'NORDLICHT / BERATUNG', 10, 'Briefing-Bold')
text(48, 741, 'PILOTPLAN', 9, 'Briefing-Bold', '#b85e3f')
text(48, 688, 'Zwei Wochen.', 30)
text(48, 646, 'Ein klarer Ablauf.', 30)
text(48, 610, 'Vom Entscheidungsbrief zum überprüfbaren Versuch.', 11, color=muted)
rect(48, 480, w - 96, 94, ink, 12)
text(68, 545, 'ZIEL DES PILOTEN', 9, 'Briefing-Bold', '#c8d9cc')
text(68, 511, 'Weniger Rückfragen im Auftragseingang.', 18, color='#fffefa')

text(48, 439, '01 / Vorbereiten', 13, 'Briefing-Bold')
text(48, 415, 'Ein Team und eine verantwortliche Ansprechperson benennen.')
text(48, 398, 'Pflichtangaben und Übergaben gemeinsam festlegen.')
text(48, 381, 'Ausgangswerte für Bearbeitungszeit und Rückfragen erfassen.')

text(48, 333, '02 / Zwei Wochen erproben', 13, 'Briefing-Bold')
text(48, 309, 'Neue Aufträge nach dem vereinbarten Ablauf bearbeiten.')
text(48, 292, 'Zeiten und Rückfragen je Fall dokumentieren.')
text(48, 275, 'Hindernisse täglich kurz besprechen und festhalten.')

text(48, 227, '03 / Gemeinsam auswerten', 13, 'Briefing-Bold')
text(48, 203, 'Die Messwerte mit dem bisherigen Ablauf vergleichen.')
text(48, 186, 'Nutzen und Einführungsaufwand getrennt bewerten.')
text(48, 169, 'Über Anpassung, Ausweitung oder Ende des Piloten entscheiden.')

rect(48, 88, w - 96, 42, '#e9edde', 6)
text(62, 105, 'Begleitdokument zum Entscheidungsbrief. Alle Angaben sind fiktiv.', 9, color=muted)
rect(48, 66, w - 96, 1, '#d7ded2')
text(48, 46, 'Staticseal / Beispiel für die Ergebnisübergabe', 9, color=muted)
text(w - 80, 46, '01 / 01', 9, color=muted)
c.showPage()
c.save()
print(output)
