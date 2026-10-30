#!/usr/bin/env python3
"""Mesure reproductible du coût Python de construction d'un overview synthétique.

Les sondes Docker, les bases et le système de fichiers sont simulés : ce benchmark ne
mesure ni Docker réel, ni SSE, ni l'interface. Il ne modifie aucun projet.
"""
import json
import math
import statistics
import sys
import time
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import odoo_manager_web as web  # noqa: E402


def percentile(values, percent):
    return sorted(values)[max(0, math.ceil(len(values) * percent) - 1)]


def measure(count, running, iterations=200):
    names = [f"bench-{index}" for index in range(count)]
    statuses = {f"{kind}-{name}": "running" if running else "exited" for name in names for kind in ("odoo", "postgresql")}
    probes = {"containers": 0, "databases": 0, "odoo": 0}

    def containers(_names):
        probes["containers"] += 1
        return statuses

    def databases(projects, _age):
        probes["databases"] += len(projects)
        return {name: [f"base_{number}" for number in range(10)] for name in projects}

    def servers(projects, _age):
        probes["odoo"] += len(projects)
        return dict.fromkeys(projects, "running")

    elapsed, cpu = [], []
    with (
        patch.object(web, "project_dirs", return_value=names),
        patch.object(web, "container_statuses", side_effect=containers),
        patch.object(web, "detected_traefik", return_value={"http_port": 80}),
        patch.object(web, "overview_databases_by_project", side_effect=databases),
        patch.object(web, "overview_odoo_servers", side_effect=servers),
        patch.object(web, "project_url", side_effect=lambda name, traefik_port: f"http://dev.{name}.localhost/"),
        patch.object(web, "project_odoo_version", return_value="18.0"),
        patch.object(web.DATABASE_RETENTION, "project_state", return_value={"databases": {}}),
    ):
        for _ in range(iterations):
            start, process_start = time.perf_counter(), time.process_time()
            payload = web.overview({"running": True, "message": "ready"})
            encoded = json.dumps(payload, ensure_ascii=False).encode()
            elapsed.append((time.perf_counter() - start) * 1000)
            cpu.append((time.process_time() - process_start) * 1000)
    return {"projects": count, "running": running, "iterations": iterations,
            "wall_ms_p50": round(statistics.median(elapsed), 3), "wall_ms_p95": round(percentile(elapsed, .95), 3),
            "cpu_ms_p50": round(statistics.median(cpu), 3), "cpu_ms_p95": round(percentile(cpu, .95), 3),
            "json_bytes": len(encoded), "simulated_probe_requests_per_overview": {key: value / iterations for key, value in probes.items()}}


if __name__ == "__main__":
    print(json.dumps([measure(count, running) for count in (1, 10, 50) for running in (False, True)], indent=2))
