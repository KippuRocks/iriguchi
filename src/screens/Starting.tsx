import { StyleSheet, Text } from "react-native";
import { Screen } from "./Screen.tsx";

/** The first screen: the application shell, until the screens of later tasks exist. */
export function Starting() {
  return (
    <Screen id="app.starting">
      <Text style={styles.brand}>Iriguchi</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { fontSize: 32, fontWeight: "600", padding: 24 },
});
