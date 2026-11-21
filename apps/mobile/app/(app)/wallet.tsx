import { View, Text } from "react-native";
import { Body, Screen, Title, usePalette } from "../../src/ui";
export default function Wallet() {
  const c = usePalette();
  return (
    <Screen>
      <Text style={{ color: c.accent, fontWeight: "800", letterSpacing: 2 }}>RENTMATE TOKENS</Text>
      <Title>Wallet</Title>
      <View
        style={{
          backgroundColor: c.card,
          borderRadius: 24,
          padding: 22,
          borderWidth: 1,
          borderColor: c.border,
          gap: 8,
        }}
      >
        <Text style={{ color: c.muted }}>Your token balance</Text>
        <Text style={{ color: c.text, fontSize: 34, fontWeight: "800" }}>—</Text>
        <Text style={{ color: c.muted }}>
          Wallet balance will appear when the authenticated ledger endpoint is connected.
        </Text>
      </View>
      <Title>Gifts & tokens</Title>
      <Body>
        Token gifts are not enabled in this build. The current wallet rules prohibit member-to-member
        transfers, cash withdrawal and redemption.
      </Body>
      <Body muted>
        No token balance or gift transaction is simulated here. Gift sending will require a reviewed ledger
        design, server-side authorization, limits, abuse controls and database migration before activation.
      </Body>
    </Screen>
  );
}
