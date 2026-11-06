"use client";

import { useSyncExternalStore } from "react";
import { useAuth } from "@/components/auth/authContext";
import { Button } from "@/components/ui/button";
import type { DrinkCategory } from "@/lib/drinks";
import { readDeviceNightProfile, subscribeDeviceNightProfile } from "@/lib/nightProfileClient";
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

export default function NearMeSavedDrink({ cityId, drinkLane, noAlcoholView, onShow }: NearMeSavedDrinkProps) {
  const auth = useAuth();
  const accountId = auth.user?.id ?? auth.session?.user.id ?? "account";
  const ownerKey = auth.identityResolved && auth.providerAuthState === "authenticated"
    ? `${accountId}:${auth.accountRevision}` : null;
  const account = useSavedNightProfile(ownerKey);
  const deviceDrink = useSyncExternalStore(
    subscribeDeviceNightProfile,
    () => savedDrinkFromProfile(readDeviceNightProfile(), cityId),
    () => null,
  );
  const accountDrink = account.status === "ready" ? savedDrinkFromProfile(account.profile, cityId) : null;
  const saved = accountDrink?.kind === "zero-proof" ? accountDrink : deviceDrink;
  if (!saved || savedDrinkIsShowing(saved, { drinkLane, noAlcoholView })) return null;
  return (
    <div className="nmnSavedDrink">
      <p className="nmnSavedDrinkText">Your saved drink is {saved.label}.</p>
      <Button variant="secondary" onClick={() => onShow(saved)}>Show {saved.label} on the map</Button>
    </div>
  );
}
