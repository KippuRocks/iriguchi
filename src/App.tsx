import type { EventId, SignedAccessPass } from "@ticketto/sdk";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { operatorServices } from "./app/services.ts";
import { currentSession, type GateChoice, loadGates, signIn, signOut } from "./operator/session.ts";
import type { OperatorSessionRecord } from "./operator/store.ts";
import { ChooseGate } from "./screens/ChooseGate.tsx";
import { OperatorSignIn } from "./screens/OperatorSignIn.tsx";
import { useRouter } from "./screens/router.ts";
import { Scan } from "./screens/Scan.tsx";
import { Starting } from "./screens/Starting.tsx";

/**
 * The application shell: sign-in until the operator has a session, then the gate
 * they choose to operate (T-050-02).
 */
export function App() {
  const services = useMemo(() => operatorServices(), []);
  const router = useRouter();
  const { navigate } = router;
  const screen = router.location.screen;
  const [session, setSession] = useState<OperatorSessionRecord | null>(null);
  const [chosen, setChosen] = useState<GateChoice | null>(null);

  // Reports a previous run left pending are sent now, once each (T-050-11).
  useEffect(() => {
    services.admissions.resume().catch(() => {});
  }, [services]);

  // The operator's session on the device decides where the app starts.
  useEffect(() => {
    if (screen !== "app.starting") return;
    currentSession(services.store, Date.now())
      .catch(() => null)
      .then((record) => {
        setSession(record);
        if (record === null) navigate("app.starting", "operator.signin", {});
        else navigate("app.starting", "gate.choose", {});
      });
  }, [screen, services, navigate]);

  const redeem = useCallback(
    async (code: string) => {
      const outcome = await signIn(services.api(null), services.store, code);
      if (outcome.kind === "signed-in") setSession(outcome.record);
      return outcome;
    },
    [services],
  );
  const gates = useCallback(async () => {
    const outcome = await loadGates(services.api(session), services.store);
    if (outcome.kind === "signed-out") setSession(null);
    return outcome;
  }, [services, session]);
  const verdictDeps = useCallback(() => services.verdict(session), [services, session]);
  const admit = useCallback(
    (pass: SignedAccessPass, presentedAt: number) => {
      const params = router.location.params;
      if (session === null || params.event === undefined || params.gate === undefined) return;
      services.admissions
        .admit({ event: params.event, gate: params.gate, pass, presentedAt, token: session.token })
        .catch(() => {});
    },
    [services, session, router.location.params],
  );
  const signedOut = useCallback(() => {
    services.store.clear().catch(() => {});
    setSession(null);
    setChosen(null);
  }, [services]);
  const endSession = useCallback(async () => {
    await signOut(services.api(session), services.store);
    setSession(null);
    setChosen(null);
  }, [services, session]);

  return (
    <View style={styles.root} testID="iriguchi-root">
      {screen === "operator.signin" ? (
        <OperatorSignIn router={router} signIn={redeem} />
      ) : screen === "gate.choose" ? (
        <ChooseGate loadGates={gates} onChoose={setChosen} router={router} signOut={endSession} />
      ) : screen === "gate.scan" &&
        router.location.params.gate !== undefined &&
        router.location.params.event !== undefined ? (
        <Scan
          event={router.location.params.event as EventId}
          eventName={chosen?.eventName ?? null}
          gate={router.location.params.gate}
          router={router}
          clock={services.clock}
          onAdmit={admit}
          onSignedOut={signedOut}
          verdictDeps={verdictDeps}
        />
      ) : (
        <Starting />
      )}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 48 },
});
