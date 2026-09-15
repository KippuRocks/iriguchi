import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "./screens/router.ts";
import { Scan } from "./screens/Scan.tsx";
import { Starting } from "./screens/Starting.tsx";

/**
 * The application shell. Screens arrive with the tasks that specify them
 * (features/050-iriguchi/tasks.md); the router decides which one is shown.
 */
export function App() {
  const router = useRouter();
  const { navigate } = router;
  const screen = router.location.screen;

  useEffect(() => {
    if (screen === "app.starting") navigate("app.starting", "gate.scan", {});
  }, [screen, navigate]);

  return (
    <View style={styles.root} testID="iriguchi-root">
      {screen === "gate.scan" ? <Scan /> : <Starting />}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 48 },
});
