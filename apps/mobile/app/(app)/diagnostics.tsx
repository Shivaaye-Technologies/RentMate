/**
 * Device-testing diagnostics: what the app saw (auth restore and refresh, API status codes, database permission
 * failures, feed counts), redacted. No tokens, keys, emails, messages or coordinates are ever recorded.
 */
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { apiBaseUrl, configResult } from "../../src/lib/supabase";
import { clearDiagnostics, diagnostics, onDiagnostics, type DiagEvent } from "../../src/lib/diagnostics";
import { Body, Button, Screen, Title, usePalette } from "../../src/ui";

const host = (url: string) => url.replace(/^https?:\/\//, "").split("/")[0] || "not set";

export default function Diagnostics() {
  const c = usePalette();
  const [events, setEvents] = useState<readonly DiagEvent[]>(diagnostics());
  useEffect(() => onDiagnostics(() => setEvents(diagnostics())), []);
  const supabaseHost = configResult.ok ? host(configResult.config.supabaseUrl) : "not configured";

  return (
    <Screen>
      <Title>Diagnostics</Title>
      <Body muted>
        For testing. Shows what this app did since it opened, without tokens, keys, emails, messages or
        locations. Take a screenshot to share it.
      </Body>
      <Body>Database and sign-in: {supabaseHost}</Body>
      <Body>RentMate server: {host(apiBaseUrl)}</Body>
      <Button label="Clear" kind="plain" onPress={clearDiagnostics} />
      {events.length === 0 ? (
        <Body muted>Nothing recorded yet. Open Home, Likes or Chat, then come back.</Body>
      ) : null}
      {[...events].reverse().map((e, i) => (
        <View
          key={`${e.at}-${i}`}
          style={{ borderBottomColor: c.border, borderBottomWidth: 1, paddingVertical: 6 }}
        >
          <Text style={{ color: c.muted, fontSize: 12 }}>
            {e.at.slice(11, 19)} · {e.area}
          </Text>
          <Text style={{ color: c.text, fontWeight: "700" }}>{e.event}</Text>
          {e.detail && Object.keys(e.detail).length ? (
            <Text style={{ color: c.text, fontSize: 12 }}>
              {Object.entries(e.detail)
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join(" · ")}
            </Text>
          ) : null}
        </View>
      ))}
    </Screen>
  );
}
