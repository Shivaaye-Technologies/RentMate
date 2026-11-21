import { useState } from "react";
import { Alert, View } from "react-native";
import { supabase } from "../lib/supabase";
import { Button, Notice } from "../ui";

type Props = {
  userId: string;
  matchId?: string;
  onBlocked?: () => void;
  onUnmatched?: () => void;
};

/** Report/block/unmatch controls. Writes are scoped to the signed-in member and enforced by RLS. */
export function SafetyActions({ userId, matchId, onBlocked, onUnmatched }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function report(reason: "fake" | "inappropriate" | "harassment" | "underage" | "scam" | "other") {
    if (!supabase || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { data } = await supabase.auth.getUser();
      const reporterId = data.user?.id;
      if (!reporterId) throw new Error("Please sign in again.");
      const { error: writeError } = await supabase.from("reports").insert({
        reporter_id: reporterId,
        reported_id: userId,
        reason,
        details: "",
      });
      if (writeError) throw new Error(writeError.message);
      setMessage("Report submitted. Thank you for helping keep RentMate safe.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit the report.");
    } finally {
      setBusy(false);
    }
  }

  function chooseReportReason() {
    Alert.alert("Report this member", "Choose the reason that best describes the concern.", [
      { text: "Fake profile", onPress: () => void report("fake") },
      { text: "Inappropriate content", onPress: () => void report("inappropriate") },
      { text: "Harassment", onPress: () => void report("harassment") },
      { text: "Underage concern", onPress: () => void report("underage") },
      { text: "Scam", onPress: () => void report("scam") },
      { text: "Other", onPress: () => void report("other") },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  function confirmBlock() {
    Alert.alert(
      "Block this member?",
      "They will no longer appear in discovery or your match conversations.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Block member", style: "destructive", onPress: () => void block() },
      ],
    );
  }

  async function block() {
    if (!supabase || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { data } = await supabase.auth.getUser();
      const blockerId = data.user?.id;
      if (!blockerId) throw new Error("Please sign in again.");
      const { error: writeError } = await supabase
        .from("blocks")
        .upsert(
          { blocker_id: blockerId, blocked_id: userId },
          { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true },
        );
      if (writeError) throw new Error(writeError.message);
      setMessage("Member blocked.");
      onBlocked?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not block this member.");
    } finally {
      setBusy(false);
    }
  }

  function confirmUnmatch() {
    if (!matchId) return;
    Alert.alert("Unmatch this member?", "Your match and its conversation will be removed.", [
      { text: "Cancel", style: "cancel" },
      { text: "Unmatch", style: "destructive", onPress: () => void unmatch() },
    ]);
  }

  async function unmatch() {
    if (!supabase || !matchId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: deleteError } = await supabase.from("matches").delete().eq("id", matchId);
      if (deleteError) throw new Error(deleteError.message);
      setMessage("Match removed.");
      onUnmatched?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove this match.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 8 }}>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {message ? <Notice kind="info">{message}</Notice> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button label="Report" kind="plain" busy={busy} disabled={busy} onPress={chooseReportReason} />
        <Button label="Block" kind="plain" busy={busy} disabled={busy} onPress={confirmBlock} />
        {matchId ? (
          <Button label="Unmatch" kind="plain" busy={busy} disabled={busy} onPress={confirmUnmatch} />
        ) : null}
      </View>
    </View>
  );
}
