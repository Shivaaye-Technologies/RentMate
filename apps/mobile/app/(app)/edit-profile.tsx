import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { Image, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { BackBar, Chip, ChipRow, EditRow, Panel } from "../../src/components/kit";
import { apiRequest, API_ROUTES, ApiError } from "../../src/lib/api";
import {
  allPhotos,
  CHILDREN_LABELS,
  detailsFromRow,
  EDUCATION_LABELS,
  EXERCISE_LABELS,
  GENDER_LABELS,
  heightLabel,
  INTEREST_CATEGORIES,
  LOOKING_FOR_LABELS,
  MAX_INTERESTS,
  MAX_NEIGHBOURHOODS,
  MAX_PLACES,
  MAX_PROMPTS,
  PLACE_CATEGORIES,
  PROMPT_ANSWER_MAX,
  PROMPT_CATEGORIES,
  SMOKING_LABELS,
  validateDetails,
  type DetailFields,
  type LookingFor,
  type ProfileRow,
} from "../../src/lib/shared";
import { apiBaseUrl, supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/session";
import { Body, Button, Notice, Screen, usePalette } from "../../src/ui";

type Editor =
  | { kind: "gender" | "education" | "children" | "smoking" | "exercise" }
  | { kind: "text"; field: "job" | "city" | "name"; label: string; max: number }
  | { kind: "height" }
  | { kind: "bio" }
  | { kind: "prompt"; index: number }
  | { kind: "interests" }
  | { kind: "list"; field: "neighbourhoods" | "favourite_places" };

const CHOICES = {
  gender: GENDER_LABELS,
  education: EDUCATION_LABELS,
  children: CHILDREN_LABELS,
  smoking: SMOKING_LABELS,
  exercise: EXERCISE_LABELS,
} as const;

const TITLES: Record<keyof typeof CHOICES, string> = {
  gender: "Gender",
  education: "Level of education",
  children: "Kids",
  smoking: "Smoking",
  exercise: "Exercise",
};

/** Edit your profile: photos, about, prompts, what you're looking for, hobbies, the basics and your places. */
export default function EditProfile() {
  const c = usePalette();
  const router = useRouter();
  const { session } = useSession();
  const me = session?.user?.id ?? null;
  const [row, setRow] = useState<ProfileRow | null>(null);
  const [details, setDetails] = useState<DetailFields>(detailsFromRow(null));
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [editor, setEditor] = useState<Editor | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const photos = row ? allPhotos(row) : [];

  const signAll = useCallback(async (paths: string[]) => {
    if (!supabase) return;
    const client = supabase;
    const pairs = await Promise.all(
      paths.map(async (p) => {
        const { data } = await client.storage.from("photos").createSignedUrl(p, 600);
        return [p, data?.signedUrl ?? null] as const;
      }),
    );
    setPhotoUrls(Object.fromEntries(pairs.filter(([, u]) => !!u)) as Record<string, string>);
  }, []);

  const load = useCallback(async () => {
    if (!supabase || !me) return setError("Please sign in again to edit your profile.");
    setError(null);
    const { data, error: e } = await supabase.from("profiles").select("*").eq("id", me).maybeSingle();
    if (e) return setError("We couldn't load your profile. Check your connection and try again.");
    if (!data) return setError("Finish creating your profile first.");
    const r = data as ProfileRow;
    setRow(r);
    setDetails(detailsFromRow(r as unknown as Parameters<typeof detailsFromRow>[0]));
    void signAll(allPhotos(r));
  }, [me, signAll]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** Name, bio, hobbies and looking-for go through the API (validated, 18+ declaration enforced). */
  async function saveBasics(
    patch: Partial<Pick<ProfileRow, "display_name" | "bio" | "interests" | "looking_for">>,
  ) {
    if (!row || !session?.access_token) return;
    const next = { ...row, ...patch };
    setBusy(true);
    setError(null);
    try {
      await apiRequest({
        base: apiBaseUrl,
        token: session.access_token,
        method: "PUT",
        path: API_ROUTES.profile,
        body: {
          displayName: next.display_name.trim(),
          age: next.age,
          bio: (next.bio ?? "").trim(),
          interests: next.interests ?? [],
          lookingFor: next.looking_for,
          ageMin: next.age_min,
          ageMax: next.age_max,
        },
      });
      setRow(next);
      setMessage("Saved.");
      setEditor(null);
    } catch (e) {
      const failure = e instanceof ApiError ? e.failure : null;
      setError(
        failure?.kind === "http" && failure.code === "age_attestation_required"
          ? "Complete your date-of-birth declaration first."
          : e instanceof Error
            ? e.message
            : "Could not save.",
      );
    } finally {
      setBusy(false);
    }
  }

  /** Optional details: validated like the database, then written to your own row (column grants apply). */
  async function saveDetails(next: DetailFields) {
    if (!supabase || !me) return;
    const checked = validateDetails(next);
    if (!checked.ok) return setError(Object.values(checked.errors)[0] ?? "Check the details.");
    setBusy(true);
    setError(null);
    const r = checked.row;
    const { error: e } = await supabase
      .from("profiles")
      .update({
        gender: r.gender,
        height_cm: r.height_cm,
        job: r.job,
        education: r.education,
        exercise: r.exercise,
        smoking: r.smoking,
        children: r.children,
        city: r.city,
        neighbourhoods: r.neighbourhoods,
        favourite_places: r.favourite_places,
        prompts: r.prompts,
      })
      .eq("id", me);
    setBusy(false);
    if (e) return setError("Could not save. Check your connection and try again.");
    setDetails(r);
    setMessage("Saved.");
    setEditor(null);
  }

  async function savePhotos(next: string[]) {
    if (!supabase || !me) throw new Error("Please sign in again.");
    const unique = [...new Set(next)].slice(0, 6);
    const { error: e } = await supabase
      .from("profiles")
      .update({ photo_path: unique[0] ?? null, photos: unique })
      .eq("id", me);
    if (e) throw new Error("Could not update your photos.");
    setRow((r) => (r ? { ...r, photo_path: unique[0] ?? null, photos: unique } : r));
    await signAll(unique);
  }

  async function addPhoto() {
    const client = supabase;
    if (busy || photos.length >= 6 || !client || !me) return;
    setBusy(true);
    setError(null);
    let uploaded: string | null = null;
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
      if (asset.fileSize && asset.fileSize > 25 * 1024 * 1024) throw new Error("That photo is over 25 MB.");
      const rendered = await ImageManipulator.ImageManipulator.manipulate(asset.uri, {
        maxWidth: 1080,
        maxHeight: 1080,
      }).renderAsync();
      // Re-encoding as JPEG drops EXIF, including any location.
      const saved = await rendered.saveAsync({ compress: 0.85, format: ImageManipulator.SaveFormat.JPEG });
      const res = await fetch(saved.uri);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > 5 * 1024 * 1024) throw new Error("Photo is too large after processing.");
      const path = `${me}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}.jpg`;
      const { error: up } = await client.storage
        .from("photos")
        .upload(path, bytes, { contentType: "image/jpeg", upsert: false });
      if (up) throw new Error("Upload failed. Please try again.");
      uploaded = path;
      await savePhotos([...photos, path]);
      uploaded = null;
      setMessage("Photo added. Location data was removed before upload.");
    } catch (e) {
      if (uploaded) void client.storage.from("photos").remove([uploaded]);
      setError(e instanceof Error ? e.message : "Photo upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto(path: string) {
    if (!supabase || busy) return;
    setBusy(true);
    try {
      await savePhotos(photos.filter((p) => p !== path));
      await supabase.storage.from("photos").remove([path]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the photo.");
    } finally {
      setBusy(false);
    }
  }

  async function makeMain(path: string) {
    if (busy) return;
    setBusy(true);
    try {
      await savePhotos([path, ...photos.filter((p) => p !== path)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reorder photos.");
    } finally {
      setBusy(false);
    }
  }

  const open = (e: Editor, initial = "") => {
    setDraft(initial);
    setError(null);
    setMessage(null);
    setEditor(e);
  };

  const section = (title: string, children: ReactNode, onEdit?: () => void, editLabel = "Edit") => (
    <View style={{ gap: 10 }}>
      <Text style={{ color: c.text, fontSize: 24, fontWeight: "600" }}>{title}</Text>
      <Panel>
        {children}
        {onEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${editLabel} ${title}`}
            onPress={onEdit}
            style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: 16, alignItems: "center" }}
          >
            <Text style={{ color: c.text, fontWeight: "800", fontSize: 16 }}>{editLabel}</Text>
          </Pressable>
        ) : null}
      </Panel>
    </View>
  );

  if (!row) {
    return (
      <Screen>
        <BackBar />
        {error ? <Notice kind="error">{error}</Notice> : <Body muted>Loading your profile…</Body>}
      </Screen>
    );
  }

  const d = details;
  return (
    <Screen>
      <BackBar
        right={
          <Pressable
            accessibilityRole="link"
            onPress={() =>
              router.push({ pathname: "/(app)/user/[id]", params: { id: row.id, self: "1" } } as never)
            }
          >
            <Text style={{ color: c.text, fontWeight: "800", fontSize: 16 }}>View my profile</Text>
          </Pressable>
        }
      />
      {error ? <Notice kind="error">{error}</Notice> : null}
      {message ? <Notice kind="info">{message}</Notice> : null}

      <Pressable
        accessibilityRole="button"
        onPress={() => open({ kind: "text", field: "name", label: "Name", max: 40 }, row.display_name)}
      >
        <Text style={{ color: c.text, fontSize: 40, fontWeight: "600", letterSpacing: -1 }}>
          {row.display_name}, {row.age} <Text style={{ fontSize: 20 }}>✎</Text>
        </Text>
      </Pressable>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
        {photos.map((p, i) => (
          <View key={p} style={{ width: 240, gap: 8 }}>
            <View
              style={{ height: 300, borderRadius: 28, overflow: "hidden", backgroundColor: c.chipActive }}
            >
              {photoUrls[p] ? (
                <Image
                  source={{ uri: photoUrls[p] }}
                  style={{ width: "100%", height: "100%" }}
                  accessibilityLabel={`Your photo ${i + 1}`}
                />
              ) : null}
              {i === 0 ? (
                <View
                  style={{
                    position: "absolute",
                    top: 12,
                    left: 12,
                    backgroundColor: c.accent,
                    borderRadius: 10,
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                  }}
                >
                  <Text style={{ color: c.onAccent, fontWeight: "700" }}>Main</Text>
                </View>
              ) : null}
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {i > 0 ? (
                <View style={{ flex: 1 }}>
                  <Button label="Make main" kind="plain" disabled={busy} onPress={() => void makeMain(p)} />
                </View>
              ) : null}
              <View style={{ flex: 1 }}>
                <Button label="Remove" kind="plain" disabled={busy} onPress={() => void removePhoto(p)} />
              </View>
            </View>
          </View>
        ))}
        {photos.length < 6 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a photo"
            disabled={busy}
            onPress={() => void addPhoto()}
            style={{
              width: 200,
              height: 300,
              borderRadius: 28,
              borderWidth: 2,
              borderStyle: "dashed",
              borderColor: c.muted,
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <Text style={{ fontSize: 40, color: c.text }}>＋</Text>
            <Text style={{ color: c.text, fontWeight: "700" }}>Add photo</Text>
            <Text style={{ color: c.muted }}>{photos.length}/6</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <Body muted>
        Photos are resized and re-encoded on your phone so location data never leaves it. Only signed-in
        members see them.
      </Body>

      {section(
        "About me",
        <Body muted={!row.bio}>{row.bio || "Write a few lines so people have something to reply to."}</Body>,
        () => open({ kind: "bio" }, row.bio ?? ""),
      )}

      {section(
        `My prompts (${d.prompts.length}/${MAX_PROMPTS})`,
        d.prompts.length ? (
          <View style={{ gap: 12 }}>
            {d.prompts.map((p, i) => (
              <Pressable
                key={p.q}
                accessibilityRole="button"
                onPress={() => open({ kind: "prompt", index: i }, p.a)}
              >
                <Text style={{ color: c.muted, fontWeight: "700" }}>“ {p.q}</Text>
                <Text style={{ color: c.text, fontSize: 17 }}>{p.a}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Body muted>Fun facts and answers make great conversation starters.</Body>
        ),
        d.prompts.length < MAX_PROMPTS ? () => open({ kind: "prompt", index: d.prompts.length }) : undefined,
        "Add",
      )}

      {section(
        "Looking for",
        <ChipRow>
          {(Object.keys(LOOKING_FOR_LABELS) as LookingFor[]).map((k) => (
            <Chip
              key={k}
              label={LOOKING_FOR_LABELS[k]}
              selected={row.looking_for === k}
              onPress={() => void saveBasics({ looking_for: k })}
            />
          ))}
        </ChipRow>,
      )}

      {section(
        `Hobbies (${(row.interests ?? []).length}/${MAX_INTERESTS})`,
        (row.interests ?? []).length ? (
          <ChipRow>
            {(row.interests ?? []).map((i) => (
              <Chip key={i} label={i} />
            ))}
          </ChipRow>
        ) : (
          <Body muted>Pick 5 hobbies to find common interests.</Body>
        ),
        () => open({ kind: "interests" }),
      )}

      <Text style={{ color: c.text, fontSize: 24, fontWeight: "600" }}>The basics</Text>
      <Panel style={{ paddingVertical: 6 }}>
        <EditRow
          glyph="🎂"
          label="Age"
          value={`${row.age} · from your date-of-birth declaration`}
          onPress={() =>
            setMessage("Your age comes from your date-of-birth declaration and can't be edited here.")
          }
        />
        <EditRow
          glyph="👥"
          label="Gender"
          value={d.gender ? GENDER_LABELS[d.gender] : null}
          onPress={() => open({ kind: "gender" })}
        />
        <EditRow
          glyph="🏠"
          label="City"
          value={d.city}
          onPress={() => open({ kind: "text", field: "city", label: "City", max: 60 }, d.city ?? "")}
        />
        <EditRow
          glyph="💼"
          label="Work"
          value={d.job}
          onPress={() => open({ kind: "text", field: "job", label: "Work", max: 60 }, d.job ?? "")}
        />
        <EditRow
          glyph="🎓"
          label="Level of education"
          value={d.education ? EDUCATION_LABELS[d.education] : null}
          onPress={() => open({ kind: "education" })}
        />
        <EditRow
          glyph="🍼"
          label="Kids"
          value={d.children ? CHILDREN_LABELS[d.children] : null}
          onPress={() => open({ kind: "children" })}
        />
        <EditRow
          glyph="🚭"
          label="Smoking"
          value={d.smoking ? SMOKING_LABELS[d.smoking] : null}
          onPress={() => open({ kind: "smoking" })}
        />
        <EditRow
          glyph="📏"
          label="Height"
          value={d.height_cm ? heightLabel(d.height_cm) : null}
          onPress={() => open({ kind: "height" }, String(d.height_cm ?? 165))}
        />
        <EditRow
          glyph="👟"
          label="Exercise"
          value={d.exercise ? EXERCISE_LABELS[d.exercise] : null}
          onPress={() => open({ kind: "exercise" })}
          last
        />
      </Panel>

      {section(
        `Favourite neighbourhoods (${d.neighbourhoods.length}/${MAX_NEIGHBOURHOODS})`,
        d.neighbourhoods.length ? (
          <ChipRow>
            {d.neighbourhoods.map((n) => (
              <Chip key={n} label={n} />
            ))}
          </ChipRow>
        ) : (
          <Body muted>Your favourite neighbourhood: the best place to hang out.</Body>
        ),
        () => open({ kind: "list", field: "neighbourhoods" }),
      )}

      {section(
        `My places (${d.favourite_places.length}/${MAX_PLACES})`,
        d.favourite_places.length ? (
          <ChipRow>
            {d.favourite_places.map((n) => (
              <Chip key={n} label={n} />
            ))}
          </ChipRow>
        ) : (
          <Body muted>Kinds of places you love. A great icebreaker.</Body>
        ),
        () => open({ kind: "list", field: "favourite_places" }),
      )}

      <Modal visible={!!editor} animationType="slide" transparent onRequestClose={() => setEditor(null)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" }}>
          <View
            style={{
              backgroundColor: c.bg,
              borderTopLeftRadius: 30,
              borderTopRightRadius: 30,
              maxHeight: "88%",
            }}
          >
            <ScrollView contentContainerStyle={{ padding: 22, gap: 14 }} keyboardShouldPersistTaps="handled">
              <View
                style={{
                  alignSelf: "center",
                  width: 48,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: c.border,
                }}
              />
              {editor ? (
                <EditorBody
                  key={JSON.stringify(editor)}
                  editor={editor}
                  draft={draft}
                  setDraft={setDraft}
                  row={row}
                  details={d}
                  busy={busy}
                  onBasics={(p) => void saveBasics(p)}
                  onDetails={(n) => void saveDetails(n)}
                />
              ) : null}
              {error ? <Notice kind="error">{error}</Notice> : null}
              <Button label="Close" kind="plain" onPress={() => setEditor(null)} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

/** The bottom sheet's content for one editor. */
function EditorBody(props: {
  editor: Editor;
  draft: string;
  setDraft: (v: string) => void;
  row: ProfileRow;
  details: DetailFields;
  busy: boolean;
  onBasics: (p: Partial<Pick<ProfileRow, "display_name" | "bio" | "interests" | "looking_for">>) => void;
  onDetails: (d: DetailFields) => void;
}) {
  const c = usePalette();
  const { editor, draft, setDraft, row, details: d, busy } = props;
  const [picked, setPicked] = useState<string[]>(
    editor.kind === "interests" ? (row.interests ?? []) : editor.kind === "list" ? d[editor.field] : [],
  );
  const [question, setQuestion] = useState<string>(
    editor.kind === "prompt" ? (d.prompts[editor.index]?.q ?? "") : "",
  );
  const title = (t: string) => <Text style={{ color: c.text, fontSize: 26, fontWeight: "700" }}>{t}</Text>;
  const input = (placeholder: string, max: number, multiline = false) => (
    <TextInput
      value={draft}
      onChangeText={setDraft}
      placeholder={placeholder}
      placeholderTextColor={c.muted}
      maxLength={max}
      multiline={multiline}
      autoFocus
      accessibilityLabel={placeholder}
      style={{
        minHeight: multiline ? 140 : 56,
        backgroundColor: c.card,
        borderRadius: 18,
        padding: 16,
        color: c.text,
        fontSize: 17,
        textAlignVertical: multiline ? "top" : "center",
      }}
    />
  );
  const toggle = (v: string, max: number) =>
    setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : p.length >= max ? p : [...p, v]));

  if (editor.kind in CHOICES) {
    const key = editor.kind as keyof typeof CHOICES;
    const labels = CHOICES[key] as Record<string, string>;
    return (
      <>
        {title(TITLES[key])}
        <ChipRow>
          {Object.entries(labels).map(([v, label]) => (
            <Chip
              key={v}
              label={label}
              selected={d[key] === v}
              onPress={() => props.onDetails({ ...d, [key]: v } as DetailFields)}
            />
          ))}
        </ChipRow>
        {d[key] ? (
          <Button
            label="Remove"
            kind="plain"
            disabled={busy}
            onPress={() => props.onDetails({ ...d, [key]: null })}
          />
        ) : null}
      </>
    );
  }
  if (editor.kind === "text") {
    return (
      <>
        {title(editor.label)}
        {input(editor.label, editor.max)}
        <Button
          label="Save"
          busy={busy}
          onPress={() =>
            editor.field === "name"
              ? props.onBasics({ display_name: draft })
              : props.onDetails({ ...d, [editor.field]: draft.trim() || null })
          }
        />
      </>
    );
  }
  if (editor.kind === "height") {
    const cm = Number(draft) || 165;
    return (
      <>
        {title("Height")}
        <Text style={{ color: c.text, fontSize: 30, fontWeight: "800", textAlign: "center" }}>
          {heightLabel(cm)}
        </Text>
        <ChipRow>
          {[-10, -1, 1, 10].map((step) => (
            <Chip
              key={step}
              label={step > 0 ? `+${step}` : String(step)}
              onPress={() => setDraft(String(Math.min(230, Math.max(120, cm + step))))}
            />
          ))}
        </ChipRow>
        <Button label="Save" busy={busy} onPress={() => props.onDetails({ ...d, height_cm: cm })} />
      </>
    );
  }
  if (editor.kind === "bio") {
    return (
      <>
        {title("About me")}
        {input("A few lines about you", 500, true)}
        <Text style={{ color: c.muted, alignSelf: "flex-end" }}>{draft.length}/500</Text>
        <Button label="Save" busy={busy} onPress={() => props.onBasics({ bio: draft })} />
      </>
    );
  }
  if (editor.kind === "prompt") {
    const existing = d.prompts[editor.index];
    const used = new Set(d.prompts.map((p) => p.q));
    return (
      <>
        {title(existing ? "Edit your answer" : "Pick a prompt")}
        {PROMPT_CATEGORIES.map((cat) => (
          <View key={cat.name} style={{ gap: 8 }}>
            <Text style={{ color: c.muted, fontWeight: "700" }}>{cat.name}</Text>
            <ChipRow>
              {cat.questions
                .filter((q) => q === existing?.q || !used.has(q))
                .map((q) => (
                  <Chip key={q} label={q} selected={question === q} onPress={() => setQuestion(q)} />
                ))}
            </ChipRow>
          </View>
        ))}
        {question ? input("Your answer", PROMPT_ANSWER_MAX, true) : null}
        <Button
          label="Save"
          busy={busy}
          disabled={!question || !draft.trim()}
          onPress={() => {
            const next = [...d.prompts];
            next[editor.index] = { q: question, a: draft.trim() };
            props.onDetails({ ...d, prompts: next });
          }}
        />
        {existing ? (
          <Button
            label="Remove prompt"
            kind="plain"
            onPress={() => props.onDetails({ ...d, prompts: d.prompts.filter((_, i) => i !== editor.index) })}
          />
        ) : null}
      </>
    );
  }
  if (editor.kind === "interests") {
    return (
      <>
        {title(`Hobbies (${picked.length}/${MAX_INTERESTS})`)}
        {INTEREST_CATEGORIES.map((cat) => (
          <View key={cat.name} style={{ gap: 8 }}>
            <Text style={{ color: c.muted, fontWeight: "700" }}>{cat.name}</Text>
            <ChipRow>
              {cat.items.map((i) => (
                <Chip
                  key={i}
                  label={i}
                  selected={picked.includes(i)}
                  onPress={() => toggle(i, MAX_INTERESTS)}
                />
              ))}
            </ChipRow>
          </View>
        ))}
        <Button label="Save" busy={busy} onPress={() => props.onBasics({ interests: picked })} />
      </>
    );
  }
  // Neighbourhoods (free text) and favourite places (kinds of place, plus your own).
  if (editor.kind !== "list") return null;
  const field = editor.field;
  const max = field === "neighbourhoods" ? MAX_NEIGHBOURHOODS : MAX_PLACES;
  return (
    <>
      {title(field === "neighbourhoods" ? "Favourite neighbourhoods" : "My places")}
      <ChipRow>
        {picked.map((p) => (
          <Chip key={p} label={`${p}  ✕`} selected onPress={() => toggle(p, max)} />
        ))}
      </ChipRow>
      {field === "favourite_places"
        ? PLACE_CATEGORIES.map((cat) => (
            <View key={cat.name} style={{ gap: 8 }}>
              <Text style={{ color: c.muted, fontWeight: "700" }}>{cat.name}</Text>
              <ChipRow>
                {cat.items.map((i) => (
                  <Chip key={i} label={i} selected={picked.includes(i)} onPress={() => toggle(i, max)} />
                ))}
              </ChipRow>
            </View>
          ))
        : null}
      {input(
        field === "neighbourhoods" ? "Add a neighbourhood (e.g. Sector 62)" : "Add your own",
        field === "neighbourhoods" ? 40 : 60,
      )}
      <Button
        label="Add"
        kind="plain"
        disabled={!draft.trim() || picked.length >= max}
        onPress={() => {
          toggle(draft.trim(), max);
          setDraft("");
        }}
      />
      <Button label="Save" busy={busy} onPress={() => props.onDetails({ ...d, [field]: picked })} />
    </>
  );
}
