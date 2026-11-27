import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { BackBar, BigTitle, Chip, ChipRow, Panel, Stepper } from "../../src/components/kit";
import { LOOKING_FOR_LABELS, SHOW_ME_LABELS, type LookingFor } from "../../src/lib/shared";
import { markFeedStale } from "../../src/lib/feed";
import { supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/session";
import { Body, Button, Notice, Screen, usePalette } from "../../src/ui";

type ShowMe = keyof typeof SHOW_ME_LABELS;

/**
 * Discovery preferences: who you want to see, their age range (18+ always) and what you're looking for. These are
 * the filters the server actually applies, so there are no "advanced filters" that would do nothing.
 */
export default function Preferences() {
  const c = usePalette();
  const { session } = useSession();
  const [showMe, setShowMe] = useState<ShowMe | null>(null);
  const [min, setMin] = useState(18);
  const [max, setMax] = useState(40);
  const [lookingFor, setLookingFor] = useState<LookingFor>("friendship");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        if (!supabase || !session?.user?.id) return;
        const { data, error: e } = await supabase
          .from("profiles")
          .select("show_me, age_min, age_max, looking_for")
          .eq("id", session.user.id)
          .maybeSingle();
        if (e || !data) return setError("Could not load your preferences.");
        const r = data as {
          show_me: ShowMe | null;
          age_min: number;
          age_max: number;
          looking_for: LookingFor;
        };
        setShowMe(r.show_me);
        setMin(r.age_min);
        setMax(r.age_max);
        setLookingFor(r.looking_for);
      })();
    }, [session?.user?.id]),
  );

  const save = async () => {
    if (!supabase || !session?.user?.id) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const { error: e } = await supabase
      .from("profiles")
      .update({ show_me: showMe, age_min: min, age_max: max, looking_for: lookingFor })
      .eq("id", session.user.id);
    setBusy(false);
    if (e) return setError("Could not save your preferences. Please try again.");
    markFeedStale();
    setSaved(true);
  };

  return (
    <Screen>
      <BackBar />
      <BigTitle sub="Refine who you see">Preferences</BigTitle>
      {error ? <Notice kind="error">{error}</Notice> : null}

      <Text style={{ color: c.text, fontSize: 22, fontWeight: "600" }}>I'm interested in</Text>
      <ChipRow>
        {(Object.keys(SHOW_ME_LABELS) as ShowMe[]).map((k) => (
          <Chip key={k} label={SHOW_ME_LABELS[k]} selected={showMe === k} onPress={() => setShowMe(k)} />
        ))}
      </ChipRow>

      <Text style={{ color: c.text, fontSize: 22, fontWeight: "600" }}>Age range</Text>
      <Panel>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Stepper label="From" value={min} min={18} max={max} onChange={setMin} />
          <Stepper label="To" value={max} min={min} max={100} onChange={setMax} />
        </View>
        <Body muted>Everyone on RentMate is 18 or older.</Body>
      </Panel>

      <Text style={{ color: c.text, fontSize: 22, fontWeight: "600" }}>Looking for</Text>
      <ChipRow>
        {(Object.keys(LOOKING_FOR_LABELS) as LookingFor[]).map((k) => (
          <Chip
            key={k}
            label={LOOKING_FOR_LABELS[k]}
            selected={lookingFor === k}
            onPress={() => setLookingFor(k)}
          />
        ))}
      </ChipRow>

      {saved ? <Notice kind="info">Saved. Home now shows people who match.</Notice> : null}
      <Button label="Save preferences" busy={busy} onPress={() => void save()} />
    </Screen>
  );
}
