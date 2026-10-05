"use client";

import { useState } from "react";
import { TextField } from "@radix-ui/themes";
import { Eye, EyeOff, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";

type DefaultPasswordInputProps = {
  value: string;
  onChange: (value: string) => void;
  /** Valeur pré-remplie d'Odoo (« odoo », « admin ») : publique, et propre au poste. */
  defaultValue: string;
  /** Ce que dit la ligne sous le champ tant que la valeur par défaut est gardée. */
  defaultHint?: string;
  disabled?: boolean;
};

/**
 * Mot de passe pré-rempli avec une valeur par défaut d'Odoo.
 *
 * Masqué sans explication, un champ pré-rempli ressemble à un champ à remplir : des utilisateurs
 * effaçaient la bonne valeur pour en taper une autre. Le mot de passe reste masqué (l'œil
 * l'affiche), mais une ligne dit qu'il n'y a rien à changer, ou, une fois modifié, offre de le rétablir.
 *
 * À côté d'un autre champ dans une grille, celle-ci doit aligner ses cellules en haut (`items-start`) :
 * la ligne sous le champ allonge la colonne.
 */
export function DefaultPasswordInput({
  value,
  onChange,
  defaultValue,
  defaultHint = "Valeur par défaut d’Odoo : rien à changer.",
  disabled = false,
}: DefaultPasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="grid gap-1.5">
      <Input
        type={visible ? "text" : "password"}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        spellCheck={false}
      >
        <TextField.Slot side="right">
          <button
            type="button"
            className="rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setVisible((current) => !current)}
            aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
            title={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </TextField.Slot>
      </Input>
      {value === defaultValue ? (
        <span className="text-xs font-normal text-muted-foreground">{defaultHint}</span>
      ) : (
        <button
          type="button"
          disabled={disabled}
          className="inline-flex items-center gap-1 justify-self-start text-xs font-normal text-primary hover:underline disabled:opacity-50"
          onClick={() => onChange(defaultValue)}
        >
          <RotateCcw className="h-3 w-3" />
          Rétablir « {defaultValue} »
        </button>
      )}
    </span>
  );
}
