#!/usr/bin/env python3
"""
ChatAero Stats Sync
Runs daily at 8am — reads ChatAero Leads.xlsx and pushes stats to Railway.
"""

import json
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

EXCEL_PATH = Path.home() / "chataero-context" / "ChatAero Leads.xlsx"
RAILWAY_URL = "https://dailytracker.up.railway.app/api/stats"

def get_week_start():
    today = datetime.now().date()
    days_since_monday = today.weekday()
    return today - timedelta(days=days_since_monday)

def parse_date(val):
    if not val:
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(str(val).strip(), fmt).date()
        except ValueError:
            continue
    return None

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

    for row in ws.iter_rows(min_row=2, values_only=True):
        emailed  = str(row[7]).strip().lower() == "yes" if row[7] else False
        date_val = parse_date(row[8]) if len(row) > 8 else None
        opened   = str(row[9]).strip().lower() == "yes" if len(row) > 9 and row[9] else False
        replied  = str(row[12]).strip().lower() == "yes" if len(row) > 12 and row[12] else False

        if emailed:
            alltime["sent"] += 1
            if opened:
                alltime["opened"] += 1
            if replied:
                alltime["replies"] += 1

            # Weekly — only count if Date Sent is this week
            if date_val and date_val >= week_start:
                weekly["sent"] += 1
                if opened:
                    weekly["opened"] += 1
                if replied:
                    weekly["replies"] += 1

    return alltime, weekly

def push_stats(alltime, weekly):
    payload = json.dumps({"alltime": alltime, "weekly": weekly}).encode()
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
        alltime, weekly = calculate_stats()
        result = push_stats(alltime, weekly)
        msg = f"[{timestamp}] OK — alltime: {alltime}, weekly: {weekly}"
    except Exception as e:
        msg = f"[{timestamp}] ERROR — {e}"

    with open(log_path, "a") as f:
        f.write(msg + "\n")

if __name__ == "__main__":
    main()
