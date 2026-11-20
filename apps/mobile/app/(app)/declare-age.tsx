import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { declareAdult, isoDate } from "../../src/lib/declareAdult";
import { supabase } from "../../src/lib/supabase";
import { Body, Button, Checkbox, Field, Notice, Screen, Title } from "../../src/ui";

/** Mandatory date of birth + 18+ declaration (attest_adult). Recorded once; a self-declaration, not verification. */
export default function DeclareAge() {
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; field?: "date" | "confirm" } | null>(null);

  async function submit() {
    if (!supabase) return;
    const client = supabase;
    setBusy(true);
    setProblem(null);
    const birth = isoDate(day, month, year);
    const result = await declareAdult(
      (args) => client.rpc("attest_adult", args),
      birth || "invalid",
      confirmed,
    );
    setBusy(false);
    if (!result.ok) return setProblem(result);
    router.replace("/home");
  }

  return (
    <Screen>
      <Title>Your date of birth</Title>
      <Body>
        RentMate is only for people aged 18 or over. Your date of birth is private: other members only see
        your age. It can be recorded once; contact support if it is wrong.
      </Body>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Field
            label="Day"
            value={day}
            onChangeText={setDay}
            keyboardType="number-pad"
            maxLength={2}
            placeholder="DD"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Month"
            value={month}
            onChangeText={setMonth}
            keyboardType="number-pad"
            maxLength={2}
            placeholder="MM"
          />
        </View>
        <View style={{ flex: 1.4 }}>
          <Field
            label="Year"
            value={year}
            onChangeText={setYear}
            keyboardType="number-pad"
            maxLength={4}
            placeholder="YYYY"
          />
        </View>
      </View>
      {problem?.field === "date" ? <Notice kind="error">{problem.message}</Notice> : null}
      <Checkbox
        label="I confirm that I am 18 or older and that this date of birth is correct."
        checked={confirmed}
        onChange={setConfirmed}
        error={problem?.field === "confirm" ? problem.message : null}
      />
      {problem && !problem.field ? <Notice kind="error">{problem.message}</Notice> : null}
      <Button label="Continue" onPress={() => void submit()} busy={busy} />
    </Screen>
  );
}
