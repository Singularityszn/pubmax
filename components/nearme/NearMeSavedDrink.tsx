"use client";

import { useAuth } from "@/components/auth/authContext";
import { Button } from "@/components/ui/button";
import type { DrinkCategory } from "@/lib/drinks";
import { savedDrinkFromProfile, savedDrinkIsShowing, type SavedDrink } from "@/lib/savedDrinkPreference";
import { useSavedNightProfile } from "@/lib/useSavedNightProfile";

import "./nearMeSavedDrink.css";

export type NearMeSavedDrinkProps = {
  cityId: string;
  drinkLane: DrinkCategory;
  noAlcoholView: boolean;
  /** Put the map under the saved drink. Nothing changes until the reader taps. */
  onShow: (saved: SavedDrink) => void;
};

/**
 * One line above the map's Near me list: the drink this account saved, and a
 * tap to show it on the map. It never switches the map by itself, so a drink
 * the reader picked this visit always stays theirs.
 */
export default function NearMeSavedDrink({ cityId, drinkLane, noAlcoholView, onShow }: NearMeSavedDrinkProps) {
  const auth = useAuth();
  const accountId = auth.user?.id ?? auth.session?.user.id ?? "account";
  const ownerKey = auth.identityResolved && auth.providerAuthState === "authenticated"
    ? `${accountId}:${auth.accountRevision}` : null;
  const account = useSavedNightProfile(ownerKey);
  const saved = account.status === "ready" ? savedDrinkFromProfile(account.profile, cityId) : null;
  if (!saved || savedDrinkIsShowing(saved, { drinkLane, noAlcoholView })) return null;
  return (
    <div className="nmnSavedDrink">
      <p className="nmnSavedDrinkText">Your saved drink is {saved.label}.</p>
      <Button variant="secondary" onClick={() => onShow(saved)}>Show {saved.label} on the map</Button>
    </div>
  );
}
