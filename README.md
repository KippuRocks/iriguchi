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

## Operators

An operator signs in by redeeming the one-time enrolment code their organiser
issued in Ibento (`auth.operator.redeemEnrolmentCode`, `F-020` §5.1, `F-024`).
Iriguchi keeps the session it opens in the platform's secure storage
(`expo-secure-store`) and holds nothing that can sign on the ledger (`REQ-CL-2`).
The operator then chooses one gate of one event among their grants
(`operators.grants.mine`), with the event's name from its public metadata
(`derived.events.get`), and the scanner opens for that gate. A revoked or ended
session returns the operator to sign-in. Whether the operator is authorised at
the gate right now is checked on every scan, not at selection (`AC-E5.2`).

Service endpoints are configuration, with placeholders until hostnames are chosen:

| Variable | Placeholder |
|---|---|
| `IRIGUCHI_KIPPU_API_URL` | `https://api.kippu.example` |

`test/kippu-api-stand-in.ts` serves kippu-api's operator procedures over tRPC's
HTTP wire format, with responses typed by `@kippu/api`, so a contract change fails
to compile. The unit tests drive the real tRPC client against it, and CI's smoke
flow runs it (`tools/ci/kippu-api-stand-in.ts`) so the development build signs in,
chooses a gate and reaches the scanner on both platforms. It is a stand-in, not
kippu-api: the system with the real services is kippu-e2e's (`F-070`).

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

## The verdict

On a scan, three checks start together, and the verdict waits for all three
(`src/verdict/verdict.ts`, `F-050` plan §5.1):

| Check | Where | Answers |
|---|---|---|
| Signature and window | `profile-v0`'s `verifyPass`, against the credential's registration read from the ledger with `getCredential` | Is the pass authentic and current? (`AC-E1.2`, `AC-E1.3`) |
| `getTicket` and `canAttend` | The ledger service, through the SDK over `binding-offchain` | Is the signer the current holder, and would the ticket admit? (`REQ-AP-1`, `REQ-Q-2`) |
| `operators.check` | kippu-api (`F-024`) | Is this operator authorised at this gate, now? (`AC-E5.2`) |

Every check only reads (`AC-E2.2`). If the ledger or Kippu does not answer, there is
no verdict and Iriguchi does not admit (`REQ-CL-3`); the gate's reads retry once,
briefly, rather than hold up the queue. When several checks refuse, the operator's
own authorisation is shown first, then the ledger's own order for a pass
(`F-008` plan §5.2): the ticket exists and belongs to this event, the pass is the
current holder's, it is within its window, then `canAttend`'s reason.

The ledger endpoints and the holder RP id are configuration, with placeholders:

| Variable | Placeholder |
|---|---|
| `IRIGUCHI_LEDGER_URL` | `https://ledger.kippu.example` |
| `IRIGUCHI_SPONSOR_URL` | `https://sponsor.kippu.example` |
| `IRIGUCHI_RP_ID` | `kippu.example` — must equal Saifu's `SAIFU_RP_ID` |

`src/verdict/verdict.test.ts` runs the verdict end to end in one process: the SDK
over `ledger-rules` (`backend-memory`), Saifu-kind holder passkeys (F-003's
simulated authenticator), and the real tRPC client to the kippu-api stand-in.
Against the ledger service and kippu-api themselves, the journeys are kippu-e2e's.

## Admit, then submit

An admission shows at once. The pass is then submitted to the ledger in the
background, directly through the SDK and sponsored through Kippu's relay
(`@kippu/sponsorship`'s `createRelaySponsor`), with the time it was presented at
the gate (`src/admission/admissions.ts`, `F-050` plan §5.2). The queue never waits
on it (`NFR-2`); submissions keep the binding's full retry budget.

When the submission has ended, the admission is reported to kippu-api
(`operators.reportAdmission`) with the exact `presentedAt` submitted, the device's
unadjusted clock, and how the submission ended: settled with its receipt's
cursor, rejected with the ledger's code, or failed. A ledger refusal after an
admission becomes a flag to the organiser (`REQ-OP-3`), not a message at the gate.
Reports are retried with the same report id until kippu-api records them or
refuses them for good, for up to 24 hours. Each report keeps the session token
its admission was made under: kippu-api accepts reports of passes presented
before a session ended for 24 hours after, so signing out loses none. Only
admissions are submitted and reported; nothing is admitted without a verdict
obtained online, so nothing is queued (`REQ-CL-3`).

## Clock and connectivity

Iriguchi compares its clock with Kippu's on every response that carries Kippu's
time — `operators.check`'s `checkedAt`, taken when the gate opens and on every scan,
and an admission report's `receivedAt` — measured at the middle of the request
(`src/clock/server-clock.ts`, `F-050` plan §5.3). Beyond 10 seconds, the tolerance
agreed with F-025, the scan screen warns the operator; the drift reaches the
organiser through each admission report, which carries the device's unadjusted
clock. Iriguchi never changes the device's clock: a pass's presentation time, and
the time its window is judged at, are server-adjusted.

Without a network connection (as the platform reports it, `@react-native-community/netinfo`)
the scan screen blocks: "No connection — cannot admit". It scans nothing and
queues nothing (`REQ-CL-3`).

## System tests

`test/system/` runs the gate against the real services: the ledger service
(`ticketto-offchain`), the sponsor relay, and kippu-api in its `staging` wiring over
that ledger. An organiser signs up and issues a granted ticket, a holder registers a
simulated passkey, and operator devices redeem enrolment codes — test fixtures, not
Iriguchi's — then Iriguchi's own verdict, submission and reports run as in the app:
`AC-E1.2`, `AC-E1.3`, `AC-E5.2`, `AC-E3.1`, `AC-E3.3`, and the two-device scenario of
`AC-E3.4`, which ends on the organiser's flag in `derived.admissionFlags.list`. The
ledger service is private, so the tests are skipped unless
`IRIGUCHI_TEST_LEDGER_URL`, `IRIGUCHI_TEST_SPONSOR_URL` and `IRIGUCHI_TEST_KIPPU_API_URL`
are set (`IRIGUCHI_TEST_RP_ID`, default `kippu.example`, is the stack's holder RP id);
kippu-e2e (`F-070`) runs them against its stack.

## Device tests

Flows in `.maestro/` run with [Maestro](https://maestro.mobile.dev) against an
installed development build. `tools/ci/smoke.sh <android|ios>` starts Metro and
runs the smoke flow; CI does this on an Android emulator (Ubuntu runner) and an
iOS simulator (macOS runner) for every pull request.

## Vendored packages

Cross-repository packages are not published. They are `pnpm pack` tarballs from
pinned commits, checked by `pnpm vendor:check` in CI:

- `@ticketto/sdk`, `profile-v0` and `binding-offchain` — and `backend-memory`,
  `ledger-rules` and `log` for tests — from `libticketto`
  (`pnpm vendor:libticketto <commit>`);
- `@kippu/api` (router types, `C5`) and `@kippu/sponsorship` (the relay client) from
  `kippu-api` (`pnpm vendor:kippu-api <commit>`).
