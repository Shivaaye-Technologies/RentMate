import { useCallback, useState } from "react";
import { Link, type Href, useFocusEffect } from "expo-router";
import { Image, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
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
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !session) {
      setError("Please sign in again to manage your profile.");
      return;
    }
    const client = supabase;
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await client.rpc("get_my_profile").maybeSingle();
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
          const { data: urlData, error: urlError } = await client.storage
            .from("photos")
            .createSignedUrl(path, 60 * 30);
          if (urlError) return null;
          return urlData.signedUrl;
        }),
      );
      const visiblePhotos = signed.flatMap((url, index) => (url ? [{ path: paths[index], url }] : []));
      setPhotoPaths(visiblePhotos.map((item) => item.path));
      setPhotoUrls(visiblePhotos.map((item) => item.url));
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
    const interestValues = [
      ...new Set(
        interests
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    ];
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
        base: apiBaseUrl,
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

  async function refreshPhotoUrls(paths: string[]) {
    const client = supabase;
    if (!client) throw new Error("Please sign in again to manage your photos.");
    const signed = await Promise.all(
      paths.map(async (path) => {
        const { data, error: signedError } = await client.storage.from("photos").createSignedUrl(path, 10 * 60);
        return signedError ? null : { path, url: data.signedUrl };
      }),
    );
    const visible = signed.flatMap((item) => (item ? [item] : []));
    setPhotoPaths(visible.map((item) => item.path));
    setPhotoUrls(visible.map((item) => item.url));
  }

  async function savePhotoPaths(next: string[]) {
    const client = supabase;
    if (!client || !session?.user?.id) throw new Error("Please sign in again to manage your photos.");
    const unique = [...new Set(next)].slice(0, 6);
    const { error: updateError } = await client
      .from("profiles")
      .update({ photo_path: unique[0] ?? null, photos: unique })
      .eq("id", session.user.id);
    if (updateError) throw new Error(updateError.message);
    await refreshPhotoUrls(unique);
  }

  async function addPhoto() {
    const client = supabase;
    if (photoBusy || photoPaths.length >= 6 || !client || !session?.user?.id) return;
    setPhotoBusy(true);
    setPhotoError(null);
    let uploadedPath: string | null = null;
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
        exif: false,
        selectionLimit: 1,
      });
      if (picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];
      if (asset.fileSize && asset.fileSize > 25 * 1024 * 1024) {
        throw new Error("That photo is over 25 MB. Choose a smaller image.");
      }
      const longest = Math.max(asset.width, asset.height);
      const actions =
        longest > 1080
          ? [{ resize: asset.width >= asset.height ? { width: 1080 } : { height: 1080 } }]
          : [];
      const processed = await ImageManipulator.manipulateAsync(asset.uri, actions, {
        compress: 0.85,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      const response = await fetch(processed.uri);
      if (!response.ok) throw new Error("Couldn't read the selected photo.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > 5 * 1024 * 1024) {
        throw new Error("Photo is too large after processing. Choose a smaller image.");
      }
      const path = `${session.user.id}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}.jpg`;
      const { error: uploadError } = await client.storage.from("photos").upload(path, bytes, {
        contentType: "image/jpeg",
        upsert: false,
      });
      if (uploadError) throw new Error(uploadError.message);
      uploadedPath = path;
      await savePhotoPaths([...photoPaths, path]);
      uploadedPath = null;
      setMessage("Photo uploaded. Location metadata was removed before upload.");
    } catch (e) {
      if (uploadedPath) void client.storage.from("photos").remove([uploadedPath]);
      setPhotoError(e instanceof Error ? e.message : "Photo upload failed.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto(path: string) {
    const client = supabase;
    if (!client || photoBusy) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      await savePhotoPaths(photoPaths.filter((item) => item !== path));
      const { error: removeError } = await client.storage.from("photos").remove([path]);
      if (removeError) setPhotoError("Photo was removed from your profile, but storage cleanup needs retry.");
      else setMessage("Photo removed.");
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : "Could not remove photo.");
    } finally {
      setPhotoBusy(false);
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
        <Field label="Age" value={age} onChangeText={setAge} keyboardType="number-pad" maxLength={3} />
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
        <Body muted>{photoPaths.length} of 6 photos. The first photo is your main photo.</Body>
        {photoUrls.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {photoUrls.map((uri, index) => (
              <View key={photoPaths[index] ?? uri} style={{ gap: 4 }}>
                <Image
                  source={{ uri }}
                  accessibilityLabel="Your private profile photo"
                  style={{ width: 104, height: 132, borderRadius: 14, backgroundColor: c.card }}
                />
                <Button
                  label={index === 0 ? "Main photo" : "Make main"}
                  kind={index === 0 ? "plain" : "primary"}
                  disabled={photoBusy || index === 0}
                  onPress={() => {
                    const next = [...photoPaths];
                    const [selected] = next.splice(index, 1);
                    next.unshift(selected);
                    setPhotoBusy(true);
                    void savePhotoPaths(next)
                      .then(() => setMessage("Main photo updated."))
                      .catch((e) => setPhotoError(e instanceof Error ? e.message : "Could not reorder photos."))
                      .finally(() => setPhotoBusy(false));
                  }}
                />
                <Button
                  label="Remove"
                  kind="plain"
                  disabled={photoBusy}
                  onPress={() => void removePhoto(photoPaths[index])}
                />
              </View>
            ))}
          </View>
        ) : (
          <Body muted>No profile photos have been added yet.</Body>
        )}
        {photoError ? <Notice kind="error">{photoError}</Notice> : null}
        <Button
          label={photoBusy ? "Please wait…" : "Add a photo"}
          onPress={() => void addPhoto()}
          busy={photoBusy}
          disabled={photoBusy || photoPaths.length >= 6 || loading}
        />
        <Notice kind="info">
          Photos are resized to at most 1080 pixels on the longest edge, re-encoded as JPEG to remove location
          metadata, and uploaded to your own folder in private Supabase Storage. Signed links expire after 10 minutes.
        </Notice>
      </View>

      <Link href={"/(app)/wallet" as Href} asChild>
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
