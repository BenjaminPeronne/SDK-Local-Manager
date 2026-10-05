"use client";

import { useState } from "react";
import { Database } from "lucide-react";
import type { Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { HintTooltip } from "@/components/common/hint-tooltip";
import { DefaultPasswordInput } from "@/components/common/default-password-input";
import { DEFAULT_ADMIN_LOGIN, DEFAULT_ADMIN_PASSWORD, DEFAULT_MASTER_PASSWORD } from "@/lib/odoo-defaults";

export function CreateDatabaseDialog({
  open,
  onOpenChange,
  project,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [db, setDb] = useState("");
  const [masterPwd, setMasterPwd] = useState(DEFAULT_MASTER_PASSWORD);
  const [login, setLogin] = useState(DEFAULT_ADMIN_LOGIN);
  const [password, setPassword] = useState(DEFAULT_ADMIN_PASSWORD);
  const [lang, setLang] = useState("fr_FR");
  const [country, setCountry] = useState("FR");
  const [demo, setDemo] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Créer une base Odoo</DialogTitle>
          <DialogDescription>{project ? `Projet cible : ${project.name}` : "Sélectionne un projet."}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-x-4 gap-y-4 md:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium">
            Nom de base
            <Input value={db} onChange={(event) => setDb(event.target.value)} placeholder="ma_base_locale" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            <span className="inline-flex items-center gap-1">
              Master password
              <HintTooltip text="Mot de passe maître d'Odoo : il autorise la création, la copie et la suppression des bases du projet." />
            </span>
            <DefaultPasswordInput value={masterPwd} onChange={setMasterPwd} defaultValue={DEFAULT_MASTER_PASSWORD} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Login admin
            <Input value={login} onChange={(event) => setLogin(event.target.value)} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            <span className="inline-flex items-center gap-1">
              Mot de passe admin
              <HintTooltip text="Mot de passe du compte admin de la nouvelle base, pour te connecter à Odoo." />
            </span>
            <DefaultPasswordInput value={password} onChange={setPassword} defaultValue={DEFAULT_ADMIN_PASSWORD} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Langue
            <Input value={lang} onChange={(event) => setLang(event.target.value)} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Pays
            <Input value={country} onChange={(event) => setCountry(event.target.value.toUpperCase())} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={demo} onCheckedChange={(checked) => setDemo(checked === true)} />
          Charger les données de démonstration
        </label>
        <Button
          disabled={!project || !db}
          onClick={() =>
            onSubmit({
              project: project?.name,
              db,
              master_pwd: masterPwd,
              login,
              password,
              lang,
              country,
              demo,
            })
          }
        >
          <Database className="h-4 w-4" />
          Créer la base
        </Button>
      </DialogContent>
    </Dialog>
  );
}
