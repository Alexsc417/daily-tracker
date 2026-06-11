#!/usr/bin/env python3
"""
ChatAero Stats Sync
Runs daily at 8am — reads ChatAero Leads.xlsx and pushes stats to Railway.

Column indices (0-based):
  7:  Emailed
  8:  Date Sent
  9:  Opened
  12: Replied
  13: Follow-up Template (A/B/C)
  14: Follow-up Sent Date
  15: Follow-up Opened
  16: Follow-up Replied
"""

import json
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

EXCEL_PATH = Path.home() / "chataero-context" / "ChatAero Leads.xlsx"
RAILWAY_URL = "https://aero.up.railway.app/api/stats"

TEMPLATE_MAP = {
    'A': 'free-demo',
    'B': 'pain-point',
    'C': 'curiosity',
}

def get_week_start():
    today = datetime.now().date()
    return today - timedelta(days=today.weekday())

def parse_date(val):
    if not val:
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(str(val).strip(), fmt).date()
        except ValueError:
            continue
    return None

def yes(val):
    return str(val).strip().lower() == 'yes' if val else False

def calculate_stats():
    try:
        import openpyxl
    except ImportError:
        import subprocess
        subprocess.run(["pip3", "install", "openpyxl", "--break-system-packages", "-q"])
        import openpyxl

    wb = openpyxl.load_workbook(EXCEL_PATH)
    ws = wb.active
    week_start = get_week_start()

    alltime = {"sent": 0, "opened": 0, "replies": 0}
    weekly  = {"sent": 0, "opened": 0, "replies": 0}
    templates = {
        'free-demo':   {"sent": 0, "opened": 0, "replies": 0},
        'pain-point':  {"sent": 0, "opened": 0, "replies": 0},
        'curiosity':   {"sent": 0, "opened": 0, "replies": 0},
    }

    for row in ws.iter_rows(min_row=2, values_only=True):
        emailed       = yes(row[7])
        date_sent     = parse_date(row[8]) if len(row) > 8 else None
        opened        = yes(row[9])        if len(row) > 9  else False
        replied       = yes(row[12])       if len(row) > 12 else False
        fu_template   = str(row[13]).strip().upper() if len(row) > 13 and row[13] else None
        fu_opened     = yes(row[15])       if len(row) > 15 else False
        fu_replied    = yes(row[16])       if len(row) > 16 else False

        # All-time cold email stats
        if emailed:
            alltime["sent"] += 1
            if opened:   alltime["opened"]  += 1
            if replied:  alltime["replies"] += 1

            # Weekly cold email stats
            if date_sent and date_sent >= week_start:
                weekly["sent"] += 1
                if opened:  weekly["opened"]  += 1
                if replied: weekly["replies"] += 1

        # Per-template follow-up stats
        if fu_template and fu_template in TEMPLATE_MAP:
            key = TEMPLATE_MAP[fu_template]
            templates[key]["sent"] += 1
            if fu_opened:  templates[key]["opened"]  += 1
            if fu_replied: templates[key]["replies"] += 1

    return alltime, weekly, templates

def push_stats(alltime, weekly, templates):
    payload = json.dumps({
        "alltime":   alltime,
        "weekly":    weekly,
        "templates": templates,
    }).encode()
    req = urllib.request.Request(
        RAILWAY_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        return res.read().decode()

def main():
    log_path = Path.home() / "chataero-context" / "sync_stats.log"
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        alltime, weekly, templates = calculate_stats()
        push_stats(alltime, weekly, templates)
        msg = f"[{timestamp}] OK — alltime: {alltime}, weekly: {weekly}, templates: {templates}"
    except Exception as e:
        msg = f"[{timestamp}] ERROR — {e}"

    with open(log_path, "a") as f:
        f.write(msg + "\n")

if __name__ == "__main__":
    main()
