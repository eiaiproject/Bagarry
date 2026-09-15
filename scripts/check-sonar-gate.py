#!/usr/bin/env python3
"""Tunggu analisis SonarCloud untuk satu revisi lalu terapkan quality gate.

Gate proyek Bagarry: nol issue OPEN/CONFIRMED/REOPENED berlevel BLOCKER atau
CRITICAL. Dihitung dari API publik SonarCloud memakai stdlib saja, tanpa token
dan tanpa mengeksekusi unduhan (aturan S8482).

Pakai: python3 scripts/check-sonar-gate.py <projectKey> <revision> [timeoutDetik]
"""

import json
import sys
import time
import urllib.parse
import urllib.request

BASE = "https://sonarcloud.io/api"
PROJECT = sys.argv[1] if len(sys.argv) > 1 else "eiaiproject_Bagarry"
REVISION = sys.argv[2] if len(sys.argv) > 2 else ""
TIMEOUT = int(sys.argv[3]) if len(sys.argv) > 3 else 600


def api(path, params):
    url = BASE + path + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=30) as res:
        return json.load(res)


def wait_for_analysis():
    deadline = time.time() + TIMEOUT
    while time.time() < deadline:
        data = api("/project_analyses/search", {"project": PROJECT, "ps": 5})
        for item in data.get("analyses", []):
            rev = item.get("revision", "")
            if rev and (REVISION.startswith(rev) or rev.startswith(REVISION[:8])):
                return item
        time.sleep(20)
    print("Timeout menunggu analisis SonarCloud untuk revisi " + REVISION[:8])
    return None


def open_blockers():
    data = api(
        "/issues/search",
        {
            "componentKeys": PROJECT,
            "ps": 100,
            "severities": "BLOCKER,CRITICAL",
            "statuses": "OPEN,CONFIRMED,REOPENED",
        },
    )
    return data.get("issues", []), data.get("total", 0)


analysis = wait_for_analysis()
if analysis is None:
    sys.exit(1)
print("Analisis:", analysis.get("date"), str(analysis.get("revision", ""))[:8])

issues, total = open_blockers()
for issue in issues:
    component = str(issue.get("component", "")).split(":")[-1]
    print("- " + str(issue.get("severity")) + " " + str(issue.get("rule", "")) + " | " + component)

if total > 0:
    print("Quality gate MERAH: %d BLOCKER/CRITICAL terbuka." % total)
    sys.exit(1)
print("Quality gate HIJAU: nol BLOCKER/CRITICAL terbuka.")
