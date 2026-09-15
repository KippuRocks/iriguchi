import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import type { ScreenId } from "./registry.ts";

export interface ScreenProps {
  readonly id: ScreenId;
  /** Waiting on something — a load, a check, a camera permission — so not yet settled. */
  readonly busy?: boolean;
  readonly children: ReactNode;
}

/**
 * A screen's root (T-050-10; `F-070` plan §5.4). It carries the `screenId` as
 * its `testID`, so a test can tell which screen it is on without reading copy,
 * and marks the screen settled — nothing loading, and no animation, since
 * Iriguchi's screens run none — with a `<screenId>.settled` element, so
 * kippu-e2e captures each journey step once it has settled.
 */
export function Screen({ id, busy = false, children }: ScreenProps) {
  return (
    <View accessibilityState={{ busy }} collapsable={false} style={styles.screen} testID={id}>
      {children}
      {busy ? null : <View collapsable={false} style={styles.marker} testID={`${id}.settled`} />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  marker: { position: "absolute", left: 0, bottom: 0, width: 1, height: 1 },
});
