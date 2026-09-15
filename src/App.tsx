import { StatusBar } from "expo-status-bar";
import { StyleSheet, View } from "react-native";
import { useRouter } from "./screens/router.ts";
import { Starting } from "./screens/Starting.tsx";

/**
 * The application shell. Screens arrive with the tasks that specify them
 * (features/050-iriguchi/tasks.md); the router decides which one is shown.
 */
export function App() {
  const router = useRouter();
  const screen = router.location.screen;
  return (
    <View style={styles.root} testID="iriguchi-root">
      {screen === "app.starting" ? <Starting /> : null}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 48 },
});
