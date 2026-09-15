import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { SignInOutcome } from "../operator/session.ts";
import type { Router } from "./router.ts";
import { Screen } from "./Screen.tsx";

export interface OperatorSignInProps {
  readonly router: Router;
  readonly signIn: (code: string) => Promise<SignInOutcome>;
}

/**
 * Operator sign-in (T-050-02; US-E5): the operator enters the one-time enrolment
 * code their organiser issued, and Iriguchi redeems it for a session (F-020 §5.1).
 */
export function OperatorSignIn({ router, signIn }: OperatorSignInProps) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<"refused" | "unreachable" | null>(null);

  const submit = async () => {
    setBusy(true);
    setFailure(null);
    const outcome = await signIn(code).catch((): SignInOutcome => ({ kind: "unreachable" }));
    setBusy(false);
    if (outcome.kind === "signed-in") {
      router.navigate("operator.signin", "gate.choose", {});
    } else {
      setFailure(outcome.kind);
    }
  };

  return (
    <Screen busy={busy} id="operator.signin">
      <View style={styles.page}>
        <Text style={styles.heading}>Sign in</Text>
        <Text style={styles.body}>Enter the enrolment code your organiser gave you.</Text>
        <TextInput
          accessibilityLabel="Enrolment code"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          onChangeText={setCode}
          onSubmitEditing={() => {
            submit().catch(() => {});
          }}
          placeholder="Enrolment code"
          style={styles.input}
          testID="signin-code"
          value={code}
        />
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            submit().catch(() => {});
          }}
          testID="signin-submit"
        >
          <Text style={styles.link}>{busy ? "Signing in…" : "Sign in"}</Text>
        </Pressable>
        {failure === "refused" ? (
          <Text style={styles.error} testID="signin-refused">
            That code did not work. Codes work once and expire: ask your organiser for a new one.
          </Text>
        ) : failure === "unreachable" ? (
          <Text style={styles.error} testID="signin-unreachable">
            Kippu could not be reached. Check the connection and try again.
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 16 },
  heading: { fontSize: 28, fontWeight: "600" },
  body: { fontSize: 16 },
  input: { borderWidth: 1, borderColor: "#8a8a8a", borderRadius: 8, padding: 12, fontSize: 18 },
  link: { fontSize: 18, color: "#1f5fbf" },
  error: { fontSize: 16, color: "#b3261e" },
});
