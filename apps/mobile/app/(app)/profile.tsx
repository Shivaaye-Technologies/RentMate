import { useCallback, useState } from "react";
import { Link, useFocusEffect } from "expo-router";
import { Image, Text, View } from "react-native";
import { useSession } from "../../src/session";
import { apiRequest, API_ROUTES, ApiError } from "../../src/lib/api";
import { apiBaseUrl, supabase } from "../../src/lib/supabase";
import { Body, Button, Field, Notice, Screen, Title, usePalette } from "../../src/ui";

type ProfileRow = {
  display_name: string;
  age: number;
  bio: string | null;
  interests: string[] | null;
  looking_for: "relationship" | "friendship" | "casual";
  age_min: number;
  age_max: number;
  photo_path: string | null;
  photos: string[] | null;
};

const emptyProfile: ProfileRow = {
  display_name: "",
  age: 18,
  bio: "",
  interests: [],
  looking_for: "relationship",
  age_min: 21,
  age_max: 35,
  photo_path: null,
  photos: [],
};

export default function Profile() {
  const c = usePalette();
  const { session } = useSession();
  const [name, setName] = useState("");
  const [age, setAge] = useState("18");
  const [bio, setBio] = useState("");
  const [interests, setInterests] = useState("");
  const [lookingFor, setLookingFor] = useState<ProfileRow["looking_for"]>("relationship");
  const [ageMin, setAgeMin] = useState("21");
  const [ageMax, setAgeMax] = useState("35");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !session) {
      setError("Please sign in again to manage your profile.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase.rpc("get_my_profile").maybeSingle();
      if (queryError) throw new Error("We couldn't load your profile. Check your connection and try again.");
      const row = (data as ProfileRow | null) ?? emptyProfile;
      setName(row.display_name ?? "");
      setAge(String(row.age ?? 18));
      setBio(row.bio ?? "");
      setInterests((row.interests ?? []).join(", "));
      setLookingFor(row.looking_for ?? "relationship");
      setAgeMin(String(row.age_min ?? 21));
      setAgeMax(String(row.age_max ?? 35));

      // Photo paths remain private. The app receives only short-lived signed URLs.
      const paths = [row.photo_path, ...(row.photos ?? [])].filter(
        (path, index, all): path is string => !!path && all.indexOf(path) === index,
      );
      const signed = await Promise.all(
        paths.slice(0, 6).map(async (path) => {
          const { data: urlData, error: urlError } = await supabase.storage
            .from("photos")
            .createSignedUrl(path, 60 * 30);
          if (urlError) return null;
          return urlData.signedUrl;
        }),
      );
      setPhotoUrls(signed.filter((url): url is string => !!url));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your profile.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function save() {
    if (!session?.access_token || saving) return;
    setError(null);
    setMessage(null);
    const parsedAge = Number(age.trim());
    const min = Number(ageMin.trim());
    const max = Number(ageMax.trim());
    const nameValue = name.trim();
    const bioValue = bio.trim();
    const interestValues = [...new Set(interests.split(",").map((v) => v.trim()).filter(Boolean))];
    if (nameValue.length < 2 || nameValue.length > 40) return setError("Name must be 2–40 characters.");
    if (!Number.isInteger(parsedAge) || parsedAge < 18 || parsedAge > 100)
      return setError("Your profile age must be between 18 and 100.");
    if (bioValue.length > 500) return setError("Your introduction must be 500 characters or fewer.");
    if (interestValues.length > 10 || interestValues.some((v) => v.length > 30))
      return setError("Add up to 10 interests, each no longer than 30 characters.");
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 18 || max > 100 || min > max)
      return setError("Choose a valid discovery age range between 18 and 100.");
    setSaving(true);
    try {
      await apiRequest({
        base: apiBaseUrl(),
        token: session.access_token,
        method: "PUT",
        path: API_ROUTES.profile,
        body: {
          displayName: nameValue,
          age: parsedAge,
          bio: bioValue,
          interests: interestValues,
          lookingFor,
          ageMin: min,
          ageMax: max,
        },
      });
      setMessage("Your profile has been saved.");
    } catch (e) {
      const failure = e instanceof ApiError ? e.failure : null;
      if (failure?.kind === "http" && failure.code === "age_attestation_required") {
        setError("Complete your date-of-birth declaration before saving your profile.");
      } else {
        setError(e instanceof Error ? e.message : "Could not save your profile.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Text style={{ color: c.accent, fontWeight: "800", letterSpacing: 2 }}>YOUR SPACE</Text>
      <Title>Your profile</Title>
      <Body muted>
        Build an honest introduction so people can get to know you. Your date of birth is not shown to other
        members; your age is.
      </Body>

      {loading ? <Body muted>Loading your profile…</Body> : null}
      {error ? <Notice kind="error">{error}</Notice> : null}
      {message ? <Notice kind="info">{message}</Notice> : null}

      <View style={{ gap: 12 }}>
        <Title>About you</Title>
        <Field label="Display name" value={name} onChangeText={setName} maxLength={40} />
        <Field
          label="Age"
          value={age}
          onChangeText={setAge}
          keyboardType="number-pad"
          maxLength={3}
        />
        <Field
          label="Introduction"
          value={bio}
          onChangeText={setBio}
          multiline
          maxLength={500}
          style={{ minHeight: 112, textAlignVertical: "top", paddingTop: 12 }}
          placeholder="A little about what you enjoy…"
        />
        <Field
          label="Interests (separate with commas)"
          value={interests}
          onChangeText={setInterests}
          maxLength={320}
          placeholder="Music, travel, food, books"
        />
        <Body muted>Choose what kind of connection you are looking for.</Body>
        {(
          [
            ["relationship", "A relationship"],
            ["friendship", "Friendship"],
            ["casual", "Nothing serious"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            label={`${lookingFor === value ? "✓ " : ""}${label}`}
            kind={lookingFor === value ? "primary" : "plain"}
            onPress={() => setLookingFor(value)}
          />
        ))}
        <Title>Discovery preferences</Title>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Field
              label="Minimum age"
              value={ageMin}
              onChangeText={setAgeMin}
              keyboardType="number-pad"
              maxLength={3}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Maximum age"
              value={ageMax}
              onChangeText={setAgeMax}
              keyboardType="number-pad"
              maxLength={3}
            />
          </View>
        </View>
        <Button label="Save profile" onPress={() => void save()} busy={saving} disabled={loading} />
      </View>

      <View style={{ gap: 10 }}>
        <Title>Profile photos</Title>
        {photoUrls.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {photoUrls.map((uri) => (
              <Image
                key={uri}
                source={{ uri }}
                accessibilityLabel="Your private profile photo"
                style={{ width: 104, height: 132, borderRadius: 14, backgroundColor: c.card }}
              />
            ))}
          </View>
        ) : (
          <Body muted>No profile photos have been added yet.</Body>
        )}
        <Notice kind="info">
          Your photos are stored in the private photos bucket and displayed with short-lived signed links.
          Photo selection and upload need the Expo image-picker native module, which is not yet installed in this
          app build.
        </Notice>
      </View>

      <Link href="/(app)/wallet" asChild>
        <Button label="Wallet & tokens" onPress={() => undefined} />
      </Link>
      <Link href="/(app)/companions" asChild>
        <Button label="Companionship options" kind="plain" onPress={() => undefined} />
      </Link>
      <Link href="/(app)/nearby" asChild>
        <Button label="Nearby and activities" kind="plain" onPress={() => undefined} />
      </Link>
      <Link href="/(app)/settings" asChild>
        <Button label="Settings and safety" kind="plain" onPress={() => undefined} />
      </Link>
      <Body muted>Profile changes are saved to your authenticated RentMate account.</Body>
    </Screen>
  );
}
