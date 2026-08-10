#!/usr/bin/env python3
"""Mutation harness with a hard timeout and a revert that always happens.

Two separate sessions lost ten minutes each to a mutant that hung instead of
failing — a synchronous BigInt loop gives a test runner nothing to interrupt —
and both times the ad-hoc shell version left the mutant sitting in the working
tree, because its revert ran after a run that never finished. This script exists
so neither can happen again: the subprocess gets a real timeout, and the restore
is in a `finally`.

Usage, single mutant:

    python tools/mutate.py --file src/core/wide/divide.ts \
        --old "remainder -= divisor" --new "remainder -= 2n * divisor" \
        --label "double subtract" --test src/core/wide/divide

Usage, a batch (JSON list of {file, old, new, label}):

    python tools/mutate.py --batch mutants.json --test src/core/wide/divide

A mutant is KILLED when the suite fails, SURVIVED when it passes, and TIMEOUT
when it ran out of time — which is a kill for scoring, but is reported apart
because it usually means an unbounded loop worth fixing in the code itself.
Exit code is 1 if anything SURVIVED, else 0.
"""

import argparse
import io
import json
import os
import shutil
import subprocess
import sys

NODE_DIR = (
    r"C:\Users\danie\AppData\Local\Microsoft\WinGet\Packages"
    r"\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe"
    r"\node-v24.19.0-win-x64"
)


def npx() -> str:
    found = shutil.which("npx") or shutil.which("npx.cmd")
    if found:
        return found
    candidate = os.path.join(NODE_DIR, "npx.cmd")
    if os.path.exists(candidate):
        return candidate
    raise SystemExit("npx not found; is node on PATH?")


def read(path: str) -> str:
    return io.open(path, encoding="utf-8", newline="").read()


def write(path: str, content: str) -> None:
    io.open(path, "w", encoding="utf-8", newline="").write(content)


def run_one(mutant: dict, test_targets: list[str], timeout: int) -> str:
    path = mutant["file"]
    original = read(path)
    if mutant["old"] not in original:
        return f"NO-MATCH  {mutant['label']} (pattern not found in {path})"

    env = dict(os.environ)
    env["PATH"] = NODE_DIR + os.pathsep + env.get("PATH", "")

    write(path, original.replace(mutant["old"], mutant["new"], 1))
    try:
        try:
            completed = subprocess.run(
                [npx(), "vitest", "run", *test_targets],
                capture_output=True,
                # Not text=True: that decodes with the console codepage (cp1252
                # here), and vitest's output is UTF-8 with arrows in it. The
                # first run of this script crashed on exactly that.
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                env=env,
                cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            )
        except subprocess.TimeoutExpired:
            return f"TIMEOUT   {mutant['label']} (>{timeout}s — check for an unbounded loop)"
        summary = next(
            (line.strip() for line in (completed.stdout + completed.stderr).splitlines() if "Tests" in line and ("passed" in line or "failed" in line)),
            f"exit {completed.returncode}",
        )
        if completed.returncode == 0:
            return f"SURVIVED  {mutant['label']} ({summary})"
        return f"KILLED    {mutant['label']} ({summary})"
    finally:
        # The whole reason this script exists.
        write(path, original)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file")
    parser.add_argument("--old")
    parser.add_argument("--new")
    parser.add_argument("--label", default="unnamed mutant")
    parser.add_argument("--batch", help="JSON file: [{file, old, new, label}, ...]")
    parser.add_argument("--test", nargs="+", required=True, help="vitest targets")
    parser.add_argument("--timeout", type=int, default=180, help="seconds per mutant")
    args = parser.parse_args()

    if args.batch:
        mutants = json.load(io.open(args.batch, encoding="utf-8"))
    else:
        if not (args.file and args.old and args.new):
            parser.error("either --batch or all of --file/--old/--new")
        mutants = [{"file": args.file, "old": args.old, "new": args.new, "label": args.label}]

    problems = 0
    for mutant in mutants:
        verdict = run_one(mutant, args.test, args.timeout)
        print(verdict, flush=True)
        # NO-MATCH counts too: a mutant that never applied tested nothing, and
        # letting it pass silently is the vacuity this project keeps finding.
        if verdict.startswith(("SURVIVED", "NO-MATCH")):
            problems += 1
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
