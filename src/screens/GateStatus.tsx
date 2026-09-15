import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ServerClock } from "../clock/server-clock.ts";

/** The device's drift from Kippu's clock while it is beyond tolerance (T-050-07; REQ-OP-3). */
export function useClockDrift(clock: ServerClock): number | null {
  const read = () => (clock.outsideTolerance() ? clock.drift() : null);
  const [drift, setDrift] = useState(read);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `read` only reads `clock`.
  useEffect(() => {
    setDrift(read());
    return clock.subscribe(() => setDrift(read()));
  }, [clock]);
  return drift;
}

/** A warning that the device's clock is off (T-050-07). Admission continues on Kippu's time. */
export function ClockDriftWarning({ drift }: { readonly drift: number }) {
  const seconds = Math.round(Math.abs(drift) / 1000);
  return (
    <View style={[styles.banner, styles.warning]} testID="clock-drift-warning">
      <Text style={styles.title}>This device's clock is off</Text>
      <Text style={styles.body}>
        It is {seconds} s {drift < 0 ? "ahead of" : "behind"} Kippu's clock. Iriguchi times
        admissions by Kippu's clock and tells the organiser. Set the device to take its time from
        the network.
      </Text>
    </View>
  );
}

/** No network: nothing can be checked, so nothing is admitted (T-050-07; REQ-CL-3). */
export function NoConnection() {
  return (
    <View style={[styles.banner, styles.blocking]} testID="gate-offline">
      <Text style={styles.title}>No connection — cannot admit</Text>
      <Text style={styles.body}>
        Iriguchi needs a connection to check every pass. Do not admit anyone until it is back.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: 12, padding: 12, gap: 4 },
  warning: { backgroundColor: "#fff4ce" },
  blocking: { backgroundColor: "#fde0dc" },
  title: { fontSize: 18, fontWeight: "600" },
  body: { fontSize: 15 },
});
