import type { EventId, SignedAccessPass } from "@ticketto/sdk";
import { type BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SCAN_FIXTURE_ENABLED, scanFixture } from "../scan/fixture.ts";
import { readScannedPass, type ScannedCode } from "../scan/read-pass.ts";
import { decide, type Verdict, type VerdictDeps } from "../verdict/verdict.ts";
import type { Router } from "./router.ts";
import { Screen } from "./Screen.tsx";

type Reading =
  | { readonly kind: "scanning" }
  /** The pass decoded; its three checks are running (T-050-04). */
  | { readonly kind: "checking"; readonly pass: SignedAccessPass }
  | { readonly kind: "verdict"; readonly verdict: Verdict }
  | { readonly kind: "unreadable" };

const time = (ms: number) => new Date(ms).toLocaleTimeString();

export interface ScanProps {
  readonly router: Router;
  /** The gate being operated (T-050-02). */
  readonly event: EventId;
  readonly gate: string;
  readonly eventName: string | null;
  /** What each verdict needs; read at every scan, so a new session is used at once. */
  readonly verdictDeps: () => VerdictDeps;
}

/**
 * The gate's scanner (T-050-03; US-E1, AD-13): the camera reads QR codes, a code is
 * read as an access pass, and the pass gets its verdict (T-050-04): admit, refuse,
 * or no verdict — never an admission without one (REQ-CL-3).
 */
export function Scan({ router, event, gate, eventName, verdictDeps }: ScanProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [reading, setReading] = useState<Reading>({ kind: "scanning" });
  const [busy, setBusy] = useState(false);

  const read = useCallback(
    (code: ScannedCode | null) => {
      const pass = code === null ? null : readScannedPass(code);
      if (!pass?.ok) {
        setReading({ kind: "unreadable" });
        return;
      }
      setReading({ kind: "checking", pass: pass.value });
      decide(verdictDeps(), { event, gate }, pass.value)
        .catch((): Verdict => ({ kind: "unavailable", pass: pass.value, unreachable: "both" }))
        .then((verdict) => setReading({ kind: "verdict", verdict }));
    },
    [verdictDeps, event, gate],
  );

  const onBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => read({ rawBytes: result.rawBytes }),
    [read],
  );

  const scanTestPass = useCallback(async () => {
    setBusy(true);
    try {
      read(await scanFixture());
    } catch {
      read(null);
    } finally {
      setBusy(false);
    }
  }, [read]);

  return (
    <Screen busy={permission === null || busy || reading.kind === "checking"} id="gate.scan">
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.gate} testID="scan-gate">
              {gate}
            </Text>
            <Text style={styles.body}>{eventName ?? "Unnamed event"}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.navigate("gate.scan", "gate.choose", {})}
            testID="scan-change-gate"
          >
            <Text style={styles.link}>Change gate</Text>
          </Pressable>
        </View>
        <Text style={styles.heading}>Scan a pass</Text>
        {permission?.granted ? (
          <View style={styles.camera}>
            {reading.kind === "scanning" ? (
              <CameraView
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                facing="back"
                onBarcodeScanned={onBarcodeScanned}
                style={StyleSheet.absoluteFill}
                testID="scan-camera"
              />
            ) : null}
          </View>
        ) : permission !== null ? (
          <View style={styles.panel}>
            <Text style={styles.body}>Iriguchi needs the camera to scan passes.</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                requestPermission().catch(() => {});
              }}
              testID="scan-allow-camera"
            >
              <Text style={styles.link}>Allow camera</Text>
            </Pressable>
          </View>
        ) : null}

        {reading.kind === "checking" ? (
          <View style={styles.panel} testID="verdict-checking">
            <Text style={styles.title}>Checking…</Text>
          </View>
        ) : reading.kind === "verdict" ? (
          <VerdictPanel verdict={reading.verdict} />
        ) : reading.kind === "unreadable" ? (
          <View style={styles.panel} testID="pass-unreadable">
            <Text style={styles.title}>This code is not a pass</Text>
            <Text style={styles.body}>Ask the holder to open the ticket in Saifu.</Text>
          </View>
        ) : null}

        {reading.kind === "verdict" || reading.kind === "unreadable" ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setReading({ kind: "scanning" })}
            testID="scan-next"
          >
            <Text style={styles.link}>Scan next</Text>
          </Pressable>
        ) : null}

        {SCAN_FIXTURE_ENABLED && reading.kind === "scanning" ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              scanTestPass().catch(() => {});
            }}
            testID="scan-fixture"
          >
            <Text style={styles.link}>Scan the test pass</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/** The verdict, as the operator acts on it. Refusal reasons in operator words are T-050-05's. */
function VerdictPanel({ verdict }: { readonly verdict: Verdict }) {
  const { pass } = verdict.pass;
  return (
    <View style={styles.panel} testID={`verdict-${verdict.kind}`}>
      {verdict.kind === "admit" ? (
        <Text style={[styles.verdict, styles.admit]}>Admit</Text>
      ) : verdict.kind === "refuse" ? (
        <>
          <Text style={[styles.verdict, styles.refuse]}>Do not admit</Text>
          <Text style={styles.body} testID="verdict-reason">
            {verdict.refusal.source === "operator" ? verdict.refusal.reason : verdict.refusal.code}
          </Text>
        </>
      ) : (
        <>
          <Text style={[styles.verdict, styles.refuse]}>No verdict — do not admit</Text>
          <Text style={styles.body}>
            {verdict.unreachable === "kippu"
              ? "Kippu could not be reached to check your authorisation."
              : "The ledger could not be reached to check this pass."}
          </Text>
        </>
      )}
      <Text style={styles.label}>Ticket</Text>
      <Text selectable style={styles.value} testID="pass-ticket">
        {pass.ticket}
      </Text>
      <Text style={styles.label}>Holder</Text>
      <Text selectable style={styles.value} testID="pass-holder">
        {pass.holder}
      </Text>
      <Text style={styles.label}>Presentable</Text>
      <Text style={styles.value}>
        {time(pass.notBefore)} – {time(pass.notAfter)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  verdict: { fontSize: 32, fontWeight: "700" },
  admit: { color: "#1b6e20" },
  refuse: { color: "#b3261e" },
  // Scrolls, so a verdict below the camera's place is reachable on a small screen.
  page: { padding: 24, gap: 16 },
  heading: { fontSize: 28, fontWeight: "600" },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerText: { flex: 1 },
  gate: { fontSize: 20, fontWeight: "600" },
  camera: { height: 320, overflow: "hidden", borderRadius: 12 },
  panel: { gap: 6 },
  title: { fontSize: 22, fontWeight: "600" },
  label: { fontSize: 14, fontWeight: "600", marginTop: 6 },
  value: { fontSize: 13, fontFamily: "Courier" },
  body: { fontSize: 16 },
  link: { fontSize: 18, color: "#1f5fbf" },
});
