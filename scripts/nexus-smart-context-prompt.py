#!/usr/bin/env python3

import argparse
import os
import sys
import importlib.util


def _load_deepsea_nexus_module(skill_repo: str):
    init_path = os.path.join(skill_repo, "__init__.py")
    spec = importlib.util.spec_from_file_location("deepsea_nexus_local", init_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("spec_create_failed")
    mod = importlib.util.module_from_spec(spec)
    mod.__package__ = "deepsea_nexus_local"
    mod.__path__ = [skill_repo]
    sys.modules["deepsea_nexus_local"] = mod
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--message", required=True)
    ap.add_argument("--config", default="")
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(here, ".."))
    skill_repo = os.path.abspath(os.path.join(repo_root, "..", "skills", "deepsea-nexus"))

    try:
        dn = _load_deepsea_nexus_module(skill_repo)
    except Exception as e:
        sys.stderr.write(f"failed_import_pkg: {e}\n")
        return 2

    try:
        nexus_init = getattr(dn, "nexus_init")
        SmartContextPlugin = getattr(dn, "SmartContextPlugin")
    except Exception as e:
        sys.stderr.write(f"failed_exports: {e}\n")
        return 2

    try:
        from deepsea_nexus_local.compat_async import run_coro_sync  # type: ignore
    except Exception as e:
        sys.stderr.write(f"failed_import_async: {e}\n")
        return 2

    try:
        ok = bool(nexus_init(args.config or None))
    except Exception as e:
        sys.stderr.write(f"nexus_init_error: {e}\n")
        return 3

    if not ok:
        sys.stderr.write("nexus_init_failed\n")
        return 3

    try:
        plugin = SmartContextPlugin()
        try:
            run_coro_sync(plugin.initialize({}))
        except Exception:
            pass
        prompt = plugin.generate_context_prompt(args.message)
        sys.stdout.write(prompt or "")
        return 0
    except Exception as e:
        sys.stderr.write(f"prompt_error: {e}\n")
        return 4


if __name__ == "__main__":
    raise SystemExit(main())
