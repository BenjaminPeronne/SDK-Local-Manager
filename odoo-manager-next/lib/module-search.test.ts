import { test } from "node:test";
import assert from "node:assert/strict";
import { searchModules } from "./module-search.ts";
import type { ModuleInfo } from "./types.ts";

function module(name: string, title: string, application = false): ModuleInfo {
  return { name, title, application, state: "installed", path: `/odoo/addons/${name}` };
}

// L'écran de la recherche « Inventaire » sur DOMEAU, dans l'ordre alphabétique d'origine.
const DOMEAU = [
  module("account_avatax_stock", "Avatax pour l'Inventaire"),
  module("approvals_purchase_stock", "Validations - Achats - Inventaire"),
  module("purchase", "Achats", true),
  module("purchase_stock", "Achats Inventaire"),
  module("sale", "Ventes"),
  module("sale_management", "Ventes", true),
  module("sale_purchase_stock_inter_company_rules", "Module intersociétés (avec un lien vers l'inventaire)"),
  module("stock", "Inventaire", true),
];

const names = (modules: ModuleInfo[]) => modules.map((item) => item.name);

test("the application comes first, before its complementary modules", () => {
  assert.equal(names(searchModules(DOMEAU, "Inventaire"))[0], "stock");
  assert.equal(names(searchModules(DOMEAU, "inventaire")).length, 5);
});

test("an application whose technical name starts with the search beats a complementary exact match", () => {
  assert.deepEqual(names(searchModules(DOMEAU, "sale")).slice(0, 2), ["sale_management", "sale"]);
  assert.equal(names(searchModules(DOMEAU, "ventes"))[0], "sale_management");
});

test("a complementary module typed in full still comes first", () => {
  assert.equal(names(searchModules(DOMEAU, "purchase_stock"))[0], "purchase_stock");
});

test("accents and case are ignored", () => {
  assert.deepEqual(names(searchModules([module("hr", "État des salariés", true)], " ETAT ")), ["hr"]);
  assert.deepEqual(names(searchModules(DOMEAU, "intersocietes")), ["sale_purchase_stock_inter_company_rules"]);
});

test("without a search the list keeps its order", () => {
  assert.deepEqual(searchModules(DOMEAU, "  "), DOMEAU);
});
