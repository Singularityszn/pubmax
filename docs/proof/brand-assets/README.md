# Brand assets on the native shells: the splash and the notification icon

Evidence for the two mobile store-readiness gaps closed on 4 September 2026:
the retired coral splash both platforms launched on in light mode, and the
missing Android notification icon.

## What was wrong

`public/store-assets/splash.svg` is the splash master, and its own comment
records the owner lock (#520/#523): a splash is not an icon, it keeps the
ink-deep field, and one splash serves light and dark. The committed master
obeyed that. The generated native art did not.

`scripts/gen-native-app-icons.mjs` restated the treatment in its own markup and
got the light variant wrong, so every light-mode launch on both platforms was a
full-bleed coral field. The committed art was older still: its mark is the
retired Clink with its ember dot, not the double-struck X.

| File | Field | Mark |
| --- | --- | --- |
| `public/store-assets/png/splash/splash-2732.png` (master) | `6,6,7` ink | `255,90,95` coral |
| iOS light splash, before | `255,90,95` coral | `255,122,85` coralBright |
| iOS light splash, after | `6,6,7` ink | `255,90,95` coral |
| Android `drawable-port-xxxhdpi`, before | `255,90,95` coral | `255,122,85` coralBright |
| Android `drawable-port-xxxhdpi`, after | `6,6,7` ink | `255,90,95` coral |

Sampled at (6,6) for the field and dead centre for the mark, decoded rather than
read off the file bytes. All 26 Android densities and all 6 iOS slots now match
the master; none carries a coral field.

## The shots

| File | What it is |
| --- | --- |
| `ios-splash-light-before.png` | The iOS `@3x` light splash at HEAD, cover-cropped to a phone frame |
| `ios-splash-light-after.png` | The same slot after the fix |
| `android-splash-light-before.png` | `drawable-port-xxxhdpi/splash.png` at HEAD |
| `android-splash-light-after.png` | The same file after the fix |
| `ios-simulator-app-running-light.png` | The rebuilt shell running on iPhone 17 Pro, light appearance |
| `ios-simulator-launchscreen-light.png` | What the iOS launch screen actually paints, light |
| `ios-simulator-launchscreen-dark.png` | The same, dark |
| `android-emulator-splash-window-light.png` | The corrected splash rendering live on the emulator, light appearance |
| `android-emulator-splash-system-light.png` | The Android 12+ system splash screen that precedes it |
| `android-emulator-app-running-light.png` | The shell with the site loaded |
| `android-notification-icon-silhouette.png` | The notification mark as Android paints it: white on the status bar's ground |

The before and after crops are the SHIPPED asset bytes, taken from `git show
HEAD:<file>` and from the working tree, cover-cropped exactly as an iPhone
scales the square source. They are the artifact the phone is handed.

## The Android notification icon, inside the built binary

`npm run android:build` compiles the new VectorDrawable and colour resource, and
the merged manifest in the shipped APK resolves both meta-data references to
them:

```
meta-data com.google.firebase.messaging.default_notification_icon  -> @0x7f0700b5
meta-data com.google.firebase.messaging.default_notification_color -> @0x7f0503b1

resource 0x7f0700b5  drawable/ic_stat_pubmaxx  (file) res/drawable/ic_stat_pubmaxx.xml
resource 0x7f0503b1  color/pubmaxx_notification_accent
```

Read with `aapt2 dump xmltree` and `aapt2 dump resources` against
`android/app/build/outputs/apk/debug/app-debug.apk`. Before this change the
manifest named neither, so FCM fell back to the launcher icon.

A screenshot of the icon in a real status bar needs a delivered FCM message,
which needs the Firebase config and the four `FCM_*` values, both owner steps
(`docs/STORE_READINESS.md` section 8). The silhouette shot above is the same
geometry the drawable carries, drawn the way the system draws it.

## Two things this proof does NOT show, and why

**The emulator runs API 36, which does not use `drawable/splash`.** Android 12
replaced the theme window background with the system SplashScreen API, so what
`android-emulator-splash-system-light.png` shows is the launcher icon on a
system-coloured field. The corrected bitmaps are what API 24 to 30 draws, and
`minSdkVersion` is 24. They are also still the activity's window background
after the system splash dismisses, which is exactly what
`android-emulator-splash-window-light.png` catches: ink field, coral
double-struck X, in light appearance (`cmd uimode night no`).

**The iOS launch screen paints no image at all, before or after.** Recording the
simulator through a cold launch and pulling frames at 50 ms shows the launch
screen as plain `systemBackgroundColor`: white in light appearance, black in
dark. Not coral before the fix, not ink after it. `UILaunchStoryboardName` is
set, `LaunchScreen.storyboard` names `image="Splash"`, and `assetutil` confirms
both Splash renditions are compiled into the built `Assets.car`, so the wiring is
whole and something below it is not drawing.

That is a SEPARATE defect from the one fixed here and it was not introduced by
this change. (Fixed on 7 September 2026: the storyboard route itself was what
drew black on the iOS 26 runtime, so the launch screen is now the `UILaunchScreen`
Info.plist kind over two asset-catalog entries cut from the same master. Before
and after: `docs/proof/mobile-app-design/ios-sim-iphone17pro/launch/`.) It does not soften the gap: the asset is wrong wherever the launch
screen does work, and the Android half renders. It is recorded here so the next
reader does not spend the same hour proving it twice.
