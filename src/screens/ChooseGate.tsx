import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { GateChoice, GatesOutcome } from "../operator/session.ts";
import type { Router } from "./router.ts";
import { Screen } from "./Screen.tsx";

export interface ChooseGateProps {
  readonly router: Router;
  readonly loadGates: () => Promise<GatesOutcome>;
  readonly onChoose: (choice: GateChoice) => void;
  readonly signOut: () => Promise<void>;
}

const time = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * Event and gate selection (T-050-02; US-E5): the gates the operator's grants
 * cover. Choosing one opens the scanner for it. Whether the grant still authorises
 * the operator is checked on every scan (AC-E5.2).
 */
export function ChooseGate({ router, loadGates, onChoose, signOut }: ChooseGateProps) {
  const [outcome, setOutcome] = useState<GatesOutcome | null>(null);

  const load = useCallback(() => {
    setOutcome(null);
    loadGates()
      .catch((): GatesOutcome => ({ kind: "unreachable" }))
      .then(setOutcome);
  }, [loadGates]);

  useEffect(load, [load]);

  useEffect(() => {
    if (outcome?.kind === "signed-out") router.navigate("gate.choose", "operator.signin", {});
  }, [outcome, router]);

  return (
    <Screen busy={outcome === null} id="gate.choose">
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.heading}>Choose a gate</Text>
        {outcome?.kind === "gates" && outcome.choices.length === 0 ? (
          <Text style={styles.body} testID="gates-none">
            You have no gates to operate. Ask your organiser to grant you one.
          </Text>
        ) : null}
        {outcome?.kind === "gates"
          ? outcome.choices.map((choice) => (
              <Pressable
                accessibilityRole="button"
                key={`${choice.grant}:${choice.gate}`}
                onPress={() => {
                  onChoose(choice);
                  router.navigate("gate.choose", "gate.scan", {
                    event: choice.event,
                    gate: choice.gate,
                  });
                }}
                style={styles.choice}
                testID="gate-choice"
              >
                <Text style={styles.gate}>{choice.gate}</Text>
                <Text style={styles.body}>{choice.eventName ?? "Unnamed event"}</Text>
                <Text style={styles.detail}>
                  {time(choice.from)} – {time(choice.until)}
                </Text>
              </Pressable>
            ))
          : null}
        {outcome?.kind === "unreachable" ? (
          <View style={styles.panel}>
            <Text style={styles.error} testID="gates-unreachable">
              Kippu could not be reached. Check the connection and try again.
            </Text>
            <Pressable accessibilityRole="button" onPress={load} testID="gates-retry">
              <Text style={styles.link}>Try again</Text>
            </Pressable>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            signOut()
              .catch(() => {})
              .then(() => router.navigate("gate.choose", "operator.signin", {}));
          }}
          testID="operator-sign-out"
        >
          <Text style={styles.link}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 16 },
  heading: { fontSize: 28, fontWeight: "600" },
  body: { fontSize: 16 },
  detail: { fontSize: 14, color: "#5f5f5f" },
  gate: { fontSize: 20, fontWeight: "600" },
  choice: { borderWidth: 1, borderColor: "#c4c4c4", borderRadius: 12, padding: 16, gap: 4 },
  panel: { gap: 8 },
  error: { fontSize: 16, color: "#b3261e" },
  link: { fontSize: 18, color: "#1f5fbf" },
});
