# iriguchi

Iriguchi — the gate app for entrance operators. Requires connectivity. Feature F-050.

This repository was reset for the V0 rebuild. The previous implementation is
preserved under the tag `legacy`.

Everything here is built from the Kippu specification and plan, in
`kippurocks/kippu-docs`: `SPEC.md` decides behaviour, `PLAN.md` and
`features/` decide how it is built. Work is tracked as one issue per feature
per milestone.

## Stack

React Native on Expo (SDK 57), TypeScript strict, ESM. Iriguchi runs as an Expo
**development build** — not Expo Go — as Saifu does, so both native clients
share one build and test harness and Iriguchi can add native modules (the
camera) without changing how it is built. The native projects are generated,
never committed: `ios/` and `android/` come from `app.json` through
`expo prebuild`.

No Expo or EAS account is used. Builds are local, on a developer machine or on a
GitHub-hosted runner.

Iriguchi requires connectivity to validate and admit (`REQ-CL-3`). It never
holds a holder's key (`REQ-CL-2`): it submits passes it cannot forge.

## Commands

Requires Node 24 and pnpm 10.17.1.

    pnpm install
    pnpm lint          # Biome
    pnpm lint:copy     # no fee vocabulary or trust claims in user-visible strings
    pnpm screens:check # every screen has an id; screens.json is up to date
    pnpm typecheck     # TypeScript
    pnpm test          # Vitest, on Node
    pnpm deps:check    # native dependencies match the Expo SDK
    pnpm bundle:check  # Metro bundles for iOS and Android

Development build, on a machine with Xcode or the Android SDK (JDK 17):

    pnpm prebuild      # generate ios/ and android/
    pnpm ios           # build, install on a simulator, start Metro
    pnpm android       # build, install on an emulator, start Metro

## Screens

Every screen renders inside `<Screen id>` (`src/screens/Screen.tsx`): its
`screenId` is the root's `testID`, and a `<screenId>.settled` element appears once
nothing is loading, so a test or a screenshot can wait for the settled screen.
The ids and titles are the router's table, `src/screens/registry.ts`; every move
between screens is a `navigate("from", "to", params)` call naming both
literally. No link opens Iriguchi.

`screens.json` is the screen manifest for kippu-e2e's navigation map (`F-070`
§5.4), in the `kippu.screens/1` format Ibento and Saifu use. It is generated and
committed:

    pnpm screens:write   # regenerate screens.json
    pnpm screens:check   # CI: fails on a screen without an id, undeclared or
                         # non-literal navigation, or an out-of-date screens.json

## Scanning

The scan screen (`gate.scan`, T-050-03) reads QR codes with `expo-camera` and reads
each one as an access pass (`AD-13`): the pass's presented bytes,
`@ticketto/profile-v0`'s `encodeSignedPass`, in one binary-mode segment — what
Saifu shows.

A binary payload does not survive the platforms' text readings of a QR code, so
`expo-camera` is patched (`patches/expo-camera@57.0.5.patch`, applied by pnpm) to
also report the symbol's decoded data codewords as `rawBytes`, base64:
`CIQRCodeDescriptor.errorCorrectedPayload` on iOS, ML Kit's `Barcode.rawBytes` on
Android. `src/scan/payload.ts` reads the byte segments back out of them, and
`decodePass` decides whether they are a pass. `expo-camera` is built from source
(`expo.autolinking.buildFromSource`) so the patch applies on Android too. Upgrading
`expo-camera` means carrying the patch forward.

Reading only decodes. Whether a pass is authentic, current and admits is the
verdict's.

Simulators and emulators have no camera to point at a phone. A development bundle
started with `EXPO_PUBLIC_IRIGUCHI_SCAN_FIXTURE=1` offers "Scan the test pass",
which reads `test/fixtures/saifu-pass.png` — a Saifu pass's QR code — through the
platform's own QR decoder (`scanFromURLAsync`) and the camera's reading path. CI's
smoke flow does this on Android and iOS. `pnpm fixtures:write` regenerates the
fixture; its inputs are fixed, so it does not change.

## Device tests

Flows in `.maestro/` run with [Maestro](https://maestro.mobile.dev) against an
installed development build. `tools/ci/smoke.sh <android|ios>` starts Metro and
runs the smoke flow; CI does this on an Android emulator (Ubuntu runner) and an
iOS simulator (macOS runner) for every pull request.

## Vendored packages

Cross-repository packages are not published. They are `pnpm pack` tarballs from
pinned commits, checked by `pnpm vendor:check` in CI:

- `@ticketto/sdk` and `@ticketto/profile-v0` from `libticketto`
  (`pnpm vendor:libticketto <commit>`).
