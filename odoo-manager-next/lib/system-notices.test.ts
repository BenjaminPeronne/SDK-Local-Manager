import { test } from "node:test";
import assert from "node:assert/strict";
import { dockerSummary, traefikNeedsAttention } from "./system-notices.ts";
import type { DockerStatus, TraefikStatus } from "./types.ts";

function docker(values: Partial<DockerStatus> = {}): DockerStatus {
  return {
    state: "stopped",
    installed: true,
    running: false,
    message: "Cannot connect to the Docker daemon at unix:///Users/me/.docker/run/docker.sock.",
    platform: "macos",
    execution_mode: "native",
    can_start: true,
    ...values,
  };
}

function traefik(values: Partial<TraefikStatus> = {}): TraefikStatus {
  return {
    state: "stopped",
    path: "/Users/me/docker-local-tools/traefik",
    installed: true,
    running: false,
    message: "Traefik est installé mais pas démarré.",
    requires_docker: true,
    can_install: false,
    can_start: true,
    ...values,
  };
}

test("a stopped Docker is described simply, its technical message kept aside", () => {
  const summary = dockerSummary(docker(), false);
  assert.equal(summary.state, "stopped");
  assert.equal(summary.title, "Docker est arrêté");
  assert.doesNotMatch(summary.message, /daemon/);
  assert.match(summary.detail, /Cannot connect to the Docker daemon/);
});

test("Docker asked to open is shown as starting until it answers", () => {
  assert.equal(dockerSummary(docker(), true).state, "starting");
  assert.equal(
    dockerSummary(docker({ running: true, state: "ready", message: "Docker est opérationnel." }), true).state,
    "ready",
  );
  // Docker absent : l'ouvrir ne peut pas avoir réussi, le guide d'installation reste affiché.
  assert.equal(dockerSummary(docker({ state: "missing", installed: false, can_start: false }), true).state, "missing");
  assert.equal(dockerSummary(undefined, false).state, "checking");
});

test("Traefik only needs attention once Docker runs", () => {
  assert.equal(traefikNeedsAttention(traefik(), false), false);
  assert.equal(traefikNeedsAttention(traefik(), true), true);
  assert.equal(traefikNeedsAttention(traefik({ running: true, state: "running" }), true), false);
  assert.equal(traefikNeedsAttention(undefined, true), false);
});
