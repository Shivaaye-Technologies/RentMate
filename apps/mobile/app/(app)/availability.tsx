import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Chips } from "../../src/components/Card";
import {
  END_CHOICES,
  minuteLabel,
  slotProblem,
  sortSlots,
  START_CHOICES,
  WEEKDAYS,
  type Slot,
} from "../../src/lib/availability";
import { supabase } from "../../src/lib/supabase";
import { Body, Button, Notice, Screen, Title, usePalette } from "../../src/ui";

/** Companions set the weekly windows members can book (India time). Bookings outside them are refused by the server. */
export default function Availability() {
  const c = usePalette();
  const [me, setMe] = useState<string | null>(null);
  const [isCompanion, setIsCompanion] = useState<boolean | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [day, setDay] = useState(1);
  const [start, setStart] = useState(600);
  const [end, setEnd] = useState(780);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return setError("App configuration is missing.");
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setError("Please sign in again.");
    setMe(auth.user.id);
    const profile = await supabase
      .from("companion_profiles")
      .select("user_id")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (profile.error) return setError("Could not check your companion profile. Try again.");
    setIsCompanion(!!profile.data);
    if (!profile.data) return;
    const { data, error: e } = await supabase
      .from("companion_availability")
      .select("id, weekday, start_minute, end_minute, timezone")
      .eq("companion_id", auth.user.id);
    if (e) return setError("Could not load your availability. Check your connection.");
    setSlots(sortSlots((data ?? []) as Slot[]));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const add = async () => {
    if (!supabase || !me) return;
    const problem = slotProblem(slots, day, start, end);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const { error: e } = await supabase
      .from("companion_availability")
      .insert({
        companion_id: me,
        weekday: day,
        start_minute: start,
        end_minute: end,
        timezone: "Asia/Kolkata",
      });
    setBusy(false);
    if (e) return setError("Could not save this window. Please try again.");
    setInfo(`Added ${WEEKDAYS[day]} ${minuteLabel(start)}–${minuteLabel(end)}.`);
    void load();
  };

  const remove = async (s: Slot) => {
    if (!supabase) return;
    setBusy(true);
    const { error: e } = await supabase.from("companion_availability").delete().eq("id", s.id);
    setBusy(false);
    if (e) return setError("Could not remove this window. Please try again.");
    setInfo("Window removed. Existing bookings are not affected.");
    void load();
  };

  if (isCompanion === null && !error) {
    return (
      <Screen>
        <ActivityIndicator accessibilityLabel="Loading availability" color={c.accent} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Availability</Title>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {info ? <Notice kind="info">{info}</Notice> : null}
      {isCompanion === false ? (
        <Body muted>
          Availability is for approved companions. Set up a companion profile on the web dashboard first.
        </Body>
      ) : (
        <>
          <Body muted>
            Weekly windows in India time. Members can only request public meetups inside them.
          </Body>
          {slots.length === 0 ? <Body muted>No windows yet.</Body> : null}
          {slots.map((s) => (
            <View
              key={s.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor: c.card,
                borderColor: c.border,
                borderWidth: 1,
                borderRadius: 12,
                padding: 12,
              }}
            >
              <Text style={{ color: c.text, fontWeight: "600" }}>
                {WEEKDAYS[s.weekday]} {minuteLabel(s.start_minute)}–{minuteLabel(s.end_minute)}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${WEEKDAYS[s.weekday]} ${minuteLabel(s.start_minute)}`}
                disabled={busy}
                onPress={() => void remove(s)}
              >
                <Text style={{ color: c.danger, fontWeight: "700" }}>Remove</Text>
              </Pressable>
            </View>
          ))}
          <Title>Add a window</Title>
          <Chips
            options={WEEKDAYS.map((d, i) => ({ label: d.slice(0, 3), value: i }))}
            value={day}
            onChange={setDay}
          />
          <Body muted>From</Body>
          <Chips
            options={START_CHOICES.map((m) => ({ label: minuteLabel(m), value: m }))}
            value={start}
            onChange={setStart}
          />
          <Body muted>Until</Body>
          <Chips
            options={END_CHOICES.map((m) => ({ label: minuteLabel(m), value: m }))}
            value={end}
            onChange={setEnd}
          />
          <Button label="Add window" busy={busy} onPress={() => void add()} />
        </>
      )}
    </Screen>
  );
}
