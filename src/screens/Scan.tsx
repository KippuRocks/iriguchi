import type { SignedAccessPass } from "@ticketto/sdk";
import { type BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SCAN_FIXTURE_ENABLED, scanFixture } from "../scan/fixture.ts";
import { readScannedPass, type ScannedCode } from "../scan/read-pass.ts";
import type { Router } from "./router.ts";
import { Screen } from "./Screen.tsx";

type Reading =
  | { readonly kind: "scanning" }
  | { readonly kind: "read"; readonly pass: SignedAccessPass }
  | { readonly kind: "unreadable" };

const time = (ms: number) => new Date(ms).toLocaleTimeString();

export interface ScanProps {
  readonly router: Router;
  /** The gate being operated (T-050-02). */
  readonly gate: string;
  readonly eventName: string | null;
}

/**
 * The gate's scanner (T-050-03; US-E1, AD-13): the camera reads QR codes, and a
 * code is read as an access pass. What the pass admits is the verdict's (T-050-04).
 */
export function Scan({ router, gate, eventName }: ScanProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [reading, setReading] = useState<Reading>({ kind: "scanning" });
  const [busy, setBusy] = useState(false);

  const read = useCallback((code: ScannedCode | null) => {
    const pass = code === null ? null : readScannedPass(code);
    setReading(pass?.ok ? { kind: "read", pass: pass.value } : { kind: "unreadable" });
  }, []);

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
    <Screen busy={permission === null || busy} id="gate.scan">
      <View style={styles.page}>
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

        {reading.kind === "read" ? (
          <View style={styles.panel} testID="pass-read">
            <Text style={styles.title}>Pass read</Text>
            <Text style={styles.label}>Ticket</Text>
            <Text selectable style={styles.value} testID="pass-ticket">
              {reading.pass.pass.ticket}
            </Text>
            <Text style={styles.label}>Holder</Text>
            <Text selectable style={styles.value} testID="pass-holder">
              {reading.pass.pass.holder}
            </Text>
            <Text style={styles.label}>Presentable</Text>
            <Text style={styles.value}>
              {time(reading.pass.pass.notBefore)} – {time(reading.pass.pass.notAfter)}
            </Text>
          </View>
        ) : reading.kind === "unreadable" ? (
          <View style={styles.panel} testID="pass-unreadable">
            <Text style={styles.title}>This code is not a pass</Text>
            <Text style={styles.body}>Ask the holder to open the ticket in Saifu.</Text>
          </View>
        ) : null}

        {reading.kind !== "scanning" ? (
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
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 24, gap: 16 },
  heading: { fontSize: 28, fontWeight: "600" },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerText: { flex: 1 },
  gate: { fontSize: 20, fontWeight: "600" },
  camera: { flex: 1, minHeight: 240, overflow: "hidden", borderRadius: 12 },
  panel: { gap: 6 },
  title: { fontSize: 22, fontWeight: "600" },
  label: { fontSize: 14, fontWeight: "600", marginTop: 6 },
  value: { fontSize: 13, fontFamily: "Courier" },
  body: { fontSize: 16 },
  link: { fontSize: 18, color: "#1f5fbf" },
});
