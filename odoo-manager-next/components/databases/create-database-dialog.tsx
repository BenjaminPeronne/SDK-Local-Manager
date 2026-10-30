"use client";

import { useRef, useState } from "react";
import { Database, Loader2 } from "lucide-react";
import type { Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { HintTooltip } from "@/components/common/hint-tooltip";
import { DefaultPasswordInput } from "@/components/common/default-password-input";
import { DEFAULT_ADMIN_LOGIN, DEFAULT_ADMIN_PASSWORD, DEFAULT_MASTER_PASSWORD } from "@/lib/odoo-defaults";
import { databaseNameError } from "@/lib/database-name";

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
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const nameError = databaseNameError(db, project?.databases);
  const langError = Boolean(lang.trim() && !/^[a-z]{2}_[A-Z]{2}$/.test(lang.trim()));
  const countryError = Boolean(country.trim() && !/^[A-Z]{2}$/.test(country.trim()));
  const accessIncomplete = !masterPwd.trim() || !login.trim() || !password.trim();

  async function submit() {
    if (!project || nameError || langError || countryError || accessIncomplete || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onSubmit({ project: project.name, db, master_pwd: masterPwd, login, password, lang, country, demo });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submittingRef.current) onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Créer une base Odoo</DialogTitle>
          <DialogDescription>{project ? `Projet cible : ${project.name}` : "Sélectionne un projet."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <section
            aria-labelledby="create-db-name-title"
            className="rounded-md border border-primary/25 bg-primary/[0.04] p-4 dark:bg-primary/[0.08]"
          >
            <h3 id="create-db-name-title" className="mb-3 text-sm font-semibold">
              Nouvelle base
            </h3>
            <label className="grid gap-1.5 text-sm font-medium">
              Nom de base
              <Input
                value={db}
                disabled={submitting}
                onChange={(event) => setDb(event.target.value)}
                placeholder="ma_base_locale"
                aria-invalid={Boolean(db && nameError)}
                aria-describedby="create-db-name-hint"
              />
              <span
                id="create-db-name-hint"
                className={
                  db && nameError ? "text-xs font-normal text-destructive" : "text-xs font-normal text-muted-foreground"
                }
              >
                {db && nameError ? nameError : "63 octets maximum, sans barre oblique ni espaces aux extrémités."}
              </span>
            </label>
          </section>
          <section aria-labelledby="create-db-access-title" className="space-y-3">
            <div>
              <h3 id="create-db-access-title" className="text-sm font-semibold">
                Accès à la base
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Le mot de passe maître autorise la création ; le compte administrateur sert à se connecter à la nouvelle
                base.
              </p>
            </div>
            <div className="grid items-start gap-4 md:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">
                <span className="inline-flex items-center gap-1">
                  Mot de passe maître du projet
                  <HintTooltip text="Mot de passe maître d'Odoo : il autorise la création, la copie et la suppression des bases du projet." />
                </span>
                <DefaultPasswordInput
                  value={masterPwd}
                  onChange={setMasterPwd}
                  defaultValue={DEFAULT_MASTER_PASSWORD}
                  disabled={submitting}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Identifiant administrateur de la base
                <Input value={login} disabled={submitting} onChange={(event) => setLogin(event.target.value)} />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                <span className="inline-flex items-center gap-1">
                  Mot de passe administrateur de la base
                  <HintTooltip text="Mot de passe du compte admin de la nouvelle base, pour te connecter à Odoo." />
                </span>
                <DefaultPasswordInput
                  value={password}
                  onChange={setPassword}
                  defaultValue={DEFAULT_ADMIN_PASSWORD}
                  disabled={submitting}
                />
              </label>
            </div>
          </section>
          <section aria-labelledby="create-db-regional-title" className="space-y-3 border-t pt-4">
            <div>
              <h3 id="create-db-regional-title" className="text-sm font-semibold">
                Langue, pays et données
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Les codes proposés sont des exemples ; leur disponibilité dépend de la version d’Odoo.
              </p>
            </div>
            <div className="grid items-start gap-4 md:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">
                Langue
                <Input
                  value={lang}
                  disabled={submitting}
                  onChange={(event) => setLang(event.target.value)}
                  list="create-db-languages"
                  aria-invalid={langError}
                  aria-describedby="create-db-language-help"
                />
                <span
                  id="create-db-language-help"
                  className={
                    langError ? "text-xs font-normal text-destructive" : "text-xs font-normal text-muted-foreground"
                  }
                >
                  {langError ? "Utilise un code comme fr_FR." : "Exemple : Français — fr_FR."}
                </span>
                <datalist id="create-db-languages">
                  <option value="fr_FR">Français — fr_FR</option>
                  <option value="en_US">Anglais — en_US</option>
                  <option value="es_ES">Espagnol — es_ES</option>
                </datalist>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Pays
                <Input
                  value={country}
                  disabled={submitting}
                  onChange={(event) => setCountry(event.target.value.toUpperCase())}
                  list="create-db-countries"
                  aria-invalid={countryError}
                  aria-describedby="create-db-country-help"
                />
                <span
                  id="create-db-country-help"
                  className={
                    countryError ? "text-xs font-normal text-destructive" : "text-xs font-normal text-muted-foreground"
                  }
                >
                  {countryError
                    ? "Utilise un code de deux lettres, comme FR."
                    : "Exemple : France — FR. Le pays peut être vide."}
                </span>
                <datalist id="create-db-countries">
                  <option value="FR">France — FR</option>
                  <option value="GP">Guadeloupe — GP</option>
                  <option value="MQ">Martinique — MQ</option>
                </datalist>
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={demo} disabled={submitting} onCheckedChange={(checked) => setDemo(checked === true)} />
              Charger les données de démonstration
            </label>
          </section>
        </div>
        {accessIncomplete && (
          <p className="text-sm text-destructive">
            Renseigne les identifiants et les deux mots de passe pour créer la base.
          </p>
        )}
        <Button
          disabled={!project || Boolean(nameError) || langError || countryError || accessIncomplete || submitting}
          onClick={() => void submit()}
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
          {submitting ? "Lancement de la création…" : "Créer la base"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
