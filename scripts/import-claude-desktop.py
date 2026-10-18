"""Import Claude Code Desktop scheduled tasks into Turno routine folders.

Usage:
    python scripts/import-claude-desktop.py [--schedules schedules.json] [dest]

- Reads every ~/.claude/scheduled-tasks/<id>/SKILL.md.
- Writes <dest>/<id>/ROUTINE.md (default dest: ~/rotinas).
- Every routine is imported DISABLED (enabled: false), so nothing runs twice while
  the same task is still enabled in Claude Desktop. Existing routines are never overwritten.
- Claude Desktop keeps the cron in its own app state, not on disk. Pass the schedules
  you want in a JSON file (keep it out of git), for example:

    {
      "daily-summary": { "days": ["mon","tue","wed","thu","fri"], "times": ["20:30"],
                         "name": "Daily summary", "timeout_min": 30 },
      "weekly-report": { "cron": "30 13 * * 1,4" }
    }

  Days: sun mon tue wed thu fri sat. Tasks without an entry are
  imported with no schedule (manual only).
"""
import argparse
import json
import os
import re

SRC = os.path.expanduser(os.path.join('~', '.claude', 'scheduled-tasks'))
ALL_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']


def q(s):
    return '"' + str(s).replace('\\', '\\\\').replace('"', '\\"') + '"'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dest', nargs='?', default=os.path.expanduser(os.path.join('~', 'rotinas')))
    ap.add_argument('--schedules', help='JSON file mapping task id -> schedule/overrides')
    args = ap.parse_args()

    schedules = {}
    if args.schedules:
        with open(args.schedules, encoding='utf-8') as f:
            schedules = json.load(f)

    if not os.path.isdir(SRC):
        print(f'No Claude Desktop scheduled tasks found in {SRC}')
        return
    os.makedirs(args.dest, exist_ok=True)

    for rid in sorted(os.listdir(SRC)):
        src = os.path.join(SRC, rid, 'SKILL.md')
        if not os.path.isfile(src):
            continue
        out_dir = os.path.join(args.dest, rid)
        if os.path.exists(os.path.join(out_dir, 'ROUTINE.md')):
            print(f'- {rid}: already exists, kept')
            continue

        raw = open(src, encoding='utf-8').read().lstrip('﻿')
        m = re.match(r'^---\r?\n(.*?)\r?\n---\r?\n?(.*)$', raw, re.S)
        fm, body = (m.group(1), m.group(2)) if m else ('', raw)
        desc = re.search(r'^description:\s*(.+)$', fm, re.M)
        title = re.search(r'^#\s+(.+)$', body, re.M)
        cfg = schedules.get(rid, {})

        name = cfg.get('name') or (title.group(1).strip() if title else rid)
        days = cfg.get('days', ALL_DAYS)
        times = cfg.get('times', [])
        cron = cfg.get('cron')
        sched = f"  days: [{', '.join(days)}]\n  times: [{', '.join(q(t) for t in times)}]\n"
        if cron:
            sched += f'  cron: {q(cron)}\n'

        yaml = f"""---
name: {q(name)}
description: {q(desc.group(1).strip() if desc else '')}
enabled: false
schedule:
{sched}timezone: {cfg.get('timezone', 'America/Sao_Paulo')}
profile: {cfg.get('profile', 'claude-max')}
model: {cfg.get('model', 'opus')}
effort: {cfg.get('effort', 'medium')}
permission_mode: {cfg.get('permission_mode', 'bypassPermissions')}
allowed_tools: []
chrome: {str(cfg.get('chrome', True)).lower()}
locks: []
lock_policy: queue
timeout_min: {cfg.get('timeout_min', 120)}
idle_timeout_min: 20
catchup: true
catchup_window_h: 6
notify: failures
---

"""
        os.makedirs(out_dir, exist_ok=True)
        open(os.path.join(out_dir, 'ROUTINE.md'), 'w', encoding='utf-8').write(yaml + body.strip() + '\n')
        when = cron or (', '.join(times) if times else 'manual only')
        print(f'+ {rid}: imported ({when})')


if __name__ == '__main__':
    main()
