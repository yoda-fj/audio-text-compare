#!/usr/bin/env python3
"""Setup a Python virtual environment and install requirements for Audio Text Compare."""

import argparse
import json
import os
import shutil
import subprocess
import sys
import venv


def log_progress(status: str, message: str) -> None:
    print(json.dumps({"type": "setup", "status": status, "message": message}), file=sys.stderr, flush=True)


def log_error(message: str) -> None:
    print(json.dumps({"type": "setup", "status": "error", "message": message}), file=sys.stderr, flush=True)


def log_ready(python_path: str) -> None:
    print(json.dumps({"type": "setup", "status": "ready", "python": python_path}), flush=True)


def get_venv_python(venv_dir: str) -> str:
    if os.name == "nt":
        return os.path.join(venv_dir, "Scripts", "python.exe")
    return os.path.join(venv_dir, "bin", "python")


def run_check(python_path: str, requirements_path: str) -> bool:
    """Check that the venv exists, has pip, and required packages are installed."""
    if not os.path.exists(python_path):
        return False

    try:
        subprocess.run([python_path, "-m", "pip", "--version"], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False

    # Parse required package names from requirements.txt
    required_packages = set()
    with open(requirements_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            pkg = line.split("=")[0].split("<")[0].split(">")[0].split("[")[0].strip().lower()
            if pkg:
                required_packages.add(pkg)

    if not required_packages:
        return True

    try:
        result = subprocess.run(
            [python_path, "-m", "pip", "list", "--format=json"],
            capture_output=True,
            text=True,
            check=True,
        )
        installed = {pkg["name"].lower() for pkg in json.loads(result.stdout)}
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        return False

    return required_packages.issubset(installed)


def main() -> None:
    parser = argparse.ArgumentParser(description="Setup Python venv for Audio Text Compare")
    parser.add_argument("--venv-dir", required=True, help="Directory where the venv will be created")
    parser.add_argument("--python", default="", help="Path to the Python executable to use for venv creation")
    parser.add_argument("--requirements", required=True, help="Path to requirements.txt")
    args = parser.parse_args()

    python_exe = args.python
    if not python_exe:
        if os.path.exists("/opt/homebrew/bin/python3.12"):
            python_exe = "/opt/homebrew/bin/python3.12"
        else:
            python_exe = shutil.which("python3.12") or shutil.which("python3") or sys.executable

    venv_dir = args.venv_dir
    venv_python = get_venv_python(venv_dir)

    if run_check(venv_python, args.requirements):
        log_ready(venv_python)
        return

    log_progress("creating_venv", f"Creating virtual environment at {venv_dir}")
    try:
        if os.path.exists(venv_dir):
            shutil.rmtree(venv_dir)
        builder = venv.EnvBuilder(with_pip=True)
        builder.create(venv_dir)
    except Exception as e:
        log_error(f"Failed to create venv: {e}")
        sys.exit(1)

    log_progress("installing_requirements", f"Installing requirements from {args.requirements}")
    try:
        result = subprocess.run(
            [venv_python, "-m", "pip", "install", "-r", args.requirements],
            capture_output=True,
            text=True,
            check=True,
        )
    except subprocess.CalledProcessError as e:
        err_msg = e.stderr.strip() if e.stderr else e.stdout.strip()
        log_error(f"Failed to install requirements: {err_msg or str(e)}")
        sys.exit(1)

    if not run_check(venv_python, args.requirements):
        log_error("Requirements installed but verification failed")
        sys.exit(1)

    log_ready(venv_python)


if __name__ == "__main__":
    main()
