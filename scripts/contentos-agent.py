#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyyaml>=6",
# ]
# ///
"""
ContentOS Agent — single-step CLI for the v2 Founder Build Wizard.

Runs 4 sequential strategy-discovery steps for a project. Each step is human-gated:
the Founder reviews + edits the output markdown before triggering the next step.

Usage:
  scripts/contentos-agent.py --project voc-ai --step 1
  scripts/contentos-agent.py --project voc-ai --step 2
  scripts/contentos-agent.py --project voc-ai --step 3
  scripts/contentos-agent.py --project voc-ai --step 4
  scripts/contentos-agent.py --project voc-ai --status

State machine:
  step_1_pending → step_1_done → step_2_pending → step_2_done → ... → step_4_done → built

State persisted at projects/<slug>/.contentos-state.json.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = REPO_ROOT / "templates" / "contentos-agent"

STEPS = [
    ("01-market-insight",     "Market Insight",       []),
    ("02-user-insight",       "User Insight",         ["01-market-insight"]),
    ("03-competitor-analysis","Competitor Analysis",  ["01-market-insight", "02-user-insight"]),
    ("04-content-strategy",   "Content Strategy",     ["01-market-insight", "02-user-insight", "03-competitor-analysis"]),
]


def load_state(project_dir: Path) -> dict:
    f = project_dir / ".contentos-state.json"
    if not f.exists():
        return {"current_step": 0, "steps": {s[0]: {"status": "pending"} for s in STEPS}}
    return json.loads(f.read_text())


def save_state(project_dir: Path, state: dict):
    state["last_updated"] = datetime.now(timezone.utc).isoformat()
    (project_dir / ".contentos-state.json").write_text(json.dumps(state, indent=2))


def show_status(project_dir: Path, project_slug: str):
    state = load_state(project_dir)
    print(f"Project: {project_slug}")
    print(f"Current step: {state.get('current_step', 0)}")
    print()
    for i, (slug, label, _) in enumerate(STEPS, 1):
        s = state["steps"].get(slug, {"status": "pending"})
        icon = {"pending": "□", "running": "⟳", "done": "✓"}.get(s["status"], "?")
        print(f"  {icon} Step {i}: {label} [{s['status']}]")
        if s.get("output_file"):
            print(f"      → {s['output_file']}")
    print()
    if state.get("current_step", 0) >= 4 and all(state["steps"][s[0]]["status"] == "done" for s in STEPS):
        print("All 4 steps done. Run ./scripts/hydrate-agents.py --project " + project_slug)


def build_step_prompt(step_idx: int, project_dir: Path, project_yaml: dict) -> str:
    step_slug, step_label, depends = STEPS[step_idx]
    template = (TEMPLATES_DIR / f"{step_slug}.md").read_text()

    parts = [f"## ContentOS Agent — Running Step {step_idx + 1}: {step_label}\n"]
    parts.append("## PROJECT YAML\n")
    parts.append(f"```yaml\n{yaml.safe_dump(project_yaml, allow_unicode=True, sort_keys=False)}```\n")

    for dep_slug in depends:
        dep_file = project_dir / "strategy" / f"{dep_slug}.md"
        if dep_file.exists():
            parts.append(f"## PRIOR OUTPUT — {dep_slug}.md (may have been edited by Founder)\n")
            parts.append(dep_file.read_text())
            parts.append("\n")
        else:
            sys.exit(f"Dependency missing: {dep_file}. Run earlier step first.")

    parts.append("## INSTRUCTION TEMPLATE\n")
    parts.append(template)
    parts.append("\n\nNow produce the output for Step {} ({}). Output ONLY the markdown brief (and, for Step 4, the AGENT-HYDRATION block at the end). No preamble. 用中文输出洞察正文；产品名、竞品名、URL、英文关键词、代码/YAML schema key 可以保留原文。".format(step_idx + 1, step_label))
    return "\n".join(parts)


def run_step(project_slug: str, step_n: int, dry_run: bool = False):
    if step_n < 1 or step_n > 4:
        sys.exit("step must be 1..4")
    step_idx = step_n - 1
    step_slug, step_label, _ = STEPS[step_idx]

    project_dir = REPO_ROOT / "projects" / project_slug
    if not project_dir.exists():
        sys.exit(f"project not found: {project_dir}")

    project_yaml = yaml.safe_load((project_dir / "project.yaml").read_text())

    state = load_state(project_dir)
    state["steps"][step_slug] = {"status": "running", "started_at": datetime.now(timezone.utc).isoformat()}
    save_state(project_dir, state)

    prompt = build_step_prompt(step_idx, project_dir, project_yaml)

    if dry_run:
        print(f"=== DRY RUN — Step {step_n} ({step_label}) ===\n")
        print(prompt[:3000])
        print(f"\n... [total prompt = {len(prompt)} chars]\n=== END DRY RUN ===")
        state["steps"][step_slug]["status"] = "pending"
        save_state(project_dir, state)
        return

    print(f"⟳ Running ContentOS Agent Step {step_n}: {step_label} for {project_slug}...")
    print(f"  prompt size = {len(prompt)} chars")
    res = subprocess.run(
        ["claude", "--print", "--allow-dangerously-skip-permissions"],
        input=prompt, text=True, capture_output=True, timeout=900,
    )
    if res.returncode != 0:
        state["steps"][step_slug]["status"] = "pending"
        state["steps"][step_slug]["error"] = res.stderr[:500]
        save_state(project_dir, state)
        sys.exit(f"claude CLI failed (exit {res.returncode}):\n{res.stderr}")

    output = res.stdout.strip()
    strategy_dir = project_dir / "strategy"
    strategy_dir.mkdir(exist_ok=True)
    out_file = strategy_dir / f"{step_slug}.md"
    out_file.write_text(output)

    existing = state["steps"].get(step_slug, {})
    state["steps"][step_slug] = {
        **existing,
        "status": "done",
        "output_file": str(out_file.relative_to(REPO_ROOT)),
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "size": len(output),
    }
    state["current_step"] = step_n
    save_state(project_dir, state)

    # Also update project.yaml.contentos_agent.state
    project_yaml.setdefault("contentos_agent", {})
    project_yaml["contentos_agent"]["state"] = f"step_{step_n}_done" if step_n < 4 else "step_4_done"
    project_yaml["contentos_agent"]["last_run"] = datetime.now(timezone.utc).isoformat()
    (project_dir / "project.yaml").write_text(
        yaml.safe_dump(project_yaml, allow_unicode=True, sort_keys=False, default_flow_style=False)
    )

    print(f"✓ Step {step_n} done.")
    print(f"  → {out_file.relative_to(REPO_ROOT)}")
    print(f"  size: {len(output)} chars")
    print()
    print(f"Next: review/edit the output, then:")
    if step_n < 4:
        print(f"  ./scripts/contentos-agent.py --project {project_slug} --step {step_n + 1}")
    else:
        print(f"  ./scripts/hydrate-agents.py --project {project_slug}   # to build registered agents from strategy")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True, help="project slug, e.g. voc-ai")
    ap.add_argument("--step", type=int, choices=[1, 2, 3, 4], help="step number")
    ap.add_argument("--status", action="store_true", help="show current state, do nothing")
    ap.add_argument("--dry-run", action="store_true", help="print prompt, do not call claude")
    args = ap.parse_args()

    project_dir = REPO_ROOT / "projects" / args.project
    if not project_dir.exists():
        sys.exit(f"project not found: {project_dir}")

    if args.status:
        show_status(project_dir, args.project)
        return

    if not args.step:
        sys.exit("--step <1-4> required (or --status)")

    run_step(args.project, args.step, args.dry_run)


if __name__ == "__main__":
    main()
