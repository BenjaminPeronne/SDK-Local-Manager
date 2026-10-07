import { test } from "node:test";
import assert from "node:assert/strict";
import { moduleOriginLabel, normalizedModuleOrigin } from "./modules.ts";

test("module origins separate standard Odoo, Enterprise and other code", () => {
  assert.equal(normalizedModuleOrigin("odoo", "/w/demo/odoo/odoo/addons/sale"), "odoo");
  assert.equal(normalizedModuleOrigin("enterprise", ""), "enterprise");
  assert.equal(normalizedModuleOrigin("other", "/w/demo/odoo/odoo/addons/sale"), "other");
  // Ancien backend sans origine : le chemin tranche.
  assert.equal(normalizedModuleOrigin(undefined, "C:\\w\\demo\\odoo\\odoo\\addons\\sale"), "odoo");
  assert.equal(normalizedModuleOrigin(undefined, "/w/demo/odoo/addons-store/odoo_entreprise/web_studio"), "enterprise");
  assert.equal(normalizedModuleOrigin(undefined, "/w/demo/odoo/addons-store/sodial-addons/sodial_base"), "other");
  assert.deepEqual((["odoo", "enterprise", "other"] as const).map(moduleOriginLabel), [
    "Odoo Community",
    "Odoo Enterprise",
    "Autre",
  ]);
});
