"use client";

import { useRef, useState } from "react";

import MessageVenuePicker, { type PickedVenue } from "@/components/messages/MessageVenuePicker";
import ProfileImageCropper from "@/components/profile/ProfileImageCropper";
import { pickNativePhoto } from "@/lib/nativeCamera";
import { isNativeApp } from "@/lib/nativePlatform";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { SUBMITTABLE_DRINK_CATEGORIES } from "@/lib/communityPrice";
import { categoryLabel, type DrinkCategory } from "@/lib/drinks";
import { PROFILE_IMAGE_PICKER_ACCEPT } from "@/lib/profileImagePicker";
import {
  DRINK_WALL_CATEGORIES,
  DRINK_WALL_CATEGORY_LABEL,
  drinkWallCaptionHint,
  type DrinkWallCategory,
} from "@/lib/drinkWall";
import { cleanDrinkWallPlaceLabel } from "@/lib/venuePhotos";
import {
  VENUE_PHOTO_CAPTION_MAX,
  VENUE_PHOTO_CROP_TARGET,
  type VenuePhotoDTO,
} from "@/lib/venuePhotos";

import "../venue/venuePhotoWall.css";

type DrinkWallComposerProps = {
  onCancel: () => void;
  onPosted: (photo: VenuePhotoDTO) => void;
};

export default function DrinkWallComposer({ onCancel, onPosted }: DrinkWallComposerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<File | null>(null);
  const [wallCategory, setWallCategory] = useState<DrinkWallCategory>("london");
  const [placeLabel, setPlaceLabel] = useState("");
  const [venue, setVenue] = useState<PickedVenue | null>(null);
  const [pickingVenue, setPickingVenue] = useState(false);
  const [drinkCategory, setDrinkCategory] = useState<DrinkCategory | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append(
        "post",
        JSON.stringify({
          wallCategory,
          venueId: venue?.id ?? null,
          placeLabel: wallCategory === "london" ? cleanDrinkWallPlaceLabel(placeLabel) : "",
          drinkCategory: wallCategory === "pint" ? drinkCategory : null,
          caption,
        }),
      );
      form.append("photo", file);
      const response = await authedActionFetch("/api/drink-wall", { method: "POST", body: form }, { requiresIdentity: true });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(offlineOrMessage(errorMessageFrom(body, "Could not add that photo. Try again.")));
        return;
      }
      const payload = body as { photo?: VenuePhotoDTO };
      if (!payload.photo) {
        setError("Could not add that photo. Try again.");
        return;
      }
      onPosted(payload.photo);
    } catch {
      setError(offlineOrMessage("Could not add that photo. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function choosePhoto() {
    if (isNativeApp()) {
      const pick = await pickNativePhoto("venue");
      if (pick.outcome === "chosen") {
        setChosen(pick.file);
        setError(null);
      } else if (pick.outcome === "blocked") {
        setError(pick.message);
      }
      return;
    }
    inputRef.current?.click();
  }

  return (
    <div className="venuePhotoComposer">
      <fieldset className="venuePhotoComposerField">
        <legend className="venuePhotoComposerLegend">Category</legend>
        <div className="venuePhotoComposerTags">
          {DRINK_WALL_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              className="venuePhotoComposerTag"
              aria-pressed={wallCategory === cat}
              onClick={() => setWallCategory(cat)}
            >
              {DRINK_WALL_CATEGORY_LABEL[cat]}
            </button>
          ))}
        </div>
      </fieldset>

      {wallCategory === "london" ? (
        <div className="venuePhotoComposerField">
          <label htmlFor="drink-wall-place">Place (optional)</label>
          <input
            id="drink-wall-place"
            className="venuePhotoComposerCaption"
            value={placeLabel}
            onChange={(event) => setPlaceLabel(event.target.value)}
          />
        </div>
      ) : null}

      <div className="venuePhotoComposerField">
        <span className="venuePhotoComposerLegend">Pub (optional)</span>
        {venue ? (
          <p className="venuePhotoWallStatus">
            {venue.name}{" "}
            <button type="button" className="composerPendingRemove" onClick={() => setVenue(null)}>
              Remove
            </button>
          </p>
        ) : pickingVenue ? (
          <MessageVenuePicker
            onPick={(picked) => {
              setVenue(picked);
              setPickingVenue(false);
            }}
            onCancel={() => setPickingVenue(false)}
          />
        ) : (
          <button type="button" className="venuePhotoWallButton" onClick={() => setPickingVenue(true)}>
            Link a pub
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={PROFILE_IMAGE_PICKER_ACCEPT}
        className="venuePhotoComposerFile"
        aria-label="Choose a drink wall photo"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          event.target.value = "";
          setChosen(file);
          setError(null);
        }}
      />

      {chosen ? (
        <ProfileImageCropper
          target={VENUE_PHOTO_CROP_TARGET}
          file={chosen}
          busy={busy}
          onCancel={() => setChosen(null)}
          onCropped={(file) => void upload(file)}
        />
      ) : (
        <button type="button" className="venuePhotoWallButton" onClick={() => void choosePhoto()}>
          Choose a photo
        </button>
      )}

      {wallCategory === "pint" ? (
        <fieldset className="venuePhotoComposerField">
          <legend className="venuePhotoComposerLegend">Drink</legend>
          <div className="venuePhotoComposerTags">
            {SUBMITTABLE_DRINK_CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                className="venuePhotoComposerTag"
                aria-pressed={drinkCategory === category}
                onClick={() => setDrinkCategory((current) => (current === category ? null : category))}
              >
                {categoryLabel(category)}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="venuePhotoComposerField">
        <label htmlFor="drink-wall-caption">Caption</label>
        <textarea
          id="drink-wall-caption"
          className="venuePhotoComposerCaption"
          maxLength={VENUE_PHOTO_CAPTION_MAX}
          rows={2}
          value={caption}
          placeholder={drinkWallCaptionHint(wallCategory)}
          onChange={(event) => setCaption(event.target.value)}
        />
      </div>

      {error ? (
        <p className="venuePhotoWallStatus venuePhotoWallStatusErr" role="status">{error}</p>
      ) : null}

      <div className="venuePhotoComposerActions">
        <button type="button" className="venuePhotoWallButton" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
