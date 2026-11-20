// Optional profile details: labels, choice lists and validation that mirrors
// the database checks in migration 20261024090000_profile_details.

export type Gender = "woman" | "man" | "nonbinary" | "other";
export type ShowMe = "women" | "men" | "everyone";
export type Education = "secondary" | "diploma" | "undergraduate" | "postgraduate" | "doctorate" | "other";
export type Exercise = "often" | "sometimes" | "rarely" | "never";
export type Smoking = "never" | "socially" | "regularly" | "quitting";
export type Children = "want" | "dont_want" | "have" | "open" | "not_sure";

export const GENDER_LABELS: Record<Gender, string> = {
  woman: "Woman",
  man: "Man",
  nonbinary: "Non-binary",
  other: "Another identity",
};
export const SHOW_ME_LABELS: Record<ShowMe, string> = {
  women: "Women",
  men: "Men",
  everyone: "Everyone",
};
export const EDUCATION_LABELS: Record<Education, string> = {
  secondary: "Secondary school",
  diploma: "Diploma",
  undergraduate: "Undergraduate degree",
  postgraduate: "Postgraduate degree",
  doctorate: "Doctorate",
  other: "Other",
};
export const EXERCISE_LABELS: Record<Exercise, string> = {
  often: "Often",
  sometimes: "Sometimes",
  rarely: "Rarely",
  never: "Never",
};
export const SMOKING_LABELS: Record<Smoking, string> = {
  never: "Doesn't smoke",
  socially: "Smokes socially",
  regularly: "Smokes",
  quitting: "Trying to quit",
};
export const CHILDREN_LABELS: Record<Children, string> = {
  want: "Wants children",
  dont_want: "Doesn't want children",
  have: "Has children",
  open: "Open to children",
  not_sure: "Not sure yet",
};

export interface Prompt {
  q: string;
  a: string;
}

export const MAX_PROMPTS = 3;
export const PROMPT_ANSWER_MAX = 200;

/** Prompt questions people can answer, grouped for the picker. */
export const PROMPT_CATEGORIES: readonly { name: string; questions: readonly string[] }[] = [
  {
    name: "About me",
    questions: ["My ideal Sunday", "I'm known for", "A fact that surprises people", "My simple pleasures"],
  },
  {
    name: "Dating",
    questions: [
      "We'll get along if",
      "The way to win me over",
      "A green flag I look for",
      "My idea of a great first date",
    ],
  },
  {
    name: "Just for fun",
    questions: [
      "Two truths and a lie",
      "My most irrational fear",
      "The best trip I've taken",
      "Don't hate me if I",
    ],
  },
  { name: "Values", questions: ["I care deeply about", "A life goal of mine", "I'm looking for"] },
];

export const MAX_PLACES = 10;
export const MAX_NEIGHBOURHOODS = 5;

/**
 * Kinds of favourite places. These are types of place, not real venues: there
 * is no reliable venue data source configured, so nothing here claims a place
 * exists in a particular city. People can also add their own.
 */
export const PLACE_CATEGORIES: readonly { name: string; items: readonly string[] }[] = [
  {
    name: "Outdoors",
    items: ["Hiking trails", "Lakesides", "Beaches", "Sunrise viewpoints", "Botanical gardens"],
  },
  {
    name: "Cafés",
    items: ["Specialty coffee", "Chai stalls", "Book cafés", "Dessert places", "Brunch spots"],
  },
  {
    name: "Restaurants",
    items: [
      "Street food lanes",
      "South Indian",
      "North Indian",
      "Pan-Asian",
      "Italian",
      "Vegetarian and vegan",
    ],
  },
  { name: "Culture", items: ["Museums", "Art galleries", "Theatre", "Heritage walks", "Bookshops"] },
  {
    name: "Entertainment",
    items: ["Live music venues", "Comedy clubs", "Cinemas", "Gaming arcades", "Karaoke"],
  },
  { name: "Sport", items: ["Gyms", "Running tracks", "Badminton courts", "Swimming pools", "Yoga studios"] },
  { name: "Parks", items: ["City parks", "Rose gardens", "Riverfronts", "Picnic spots"] },
  {
    name: "Other local activities",
    items: ["Farmers' markets", "Flea markets", "Pottery classes", "Dance classes", "Volunteering"],
  },
];

/** City suggestions for the search box. Any other city can be typed in. */
export const CITIES: readonly string[] = [
  "Agra",
  "Ahmedabad",
  "Amritsar",
  "Bengaluru",
  "Bhopal",
  "Bhubaneswar",
  "Chandigarh",
  "Chennai",
  "Coimbatore",
  "Dehradun",
  "Delhi",
  "Faridabad",
  "Ghaziabad",
  "Goa",
  "Gurugram",
  "Guwahati",
  "Hyderabad",
  "Indore",
  "Jaipur",
  "Jodhpur",
  "Kanpur",
  "Kochi",
  "Kolkata",
  "Kozhikode",
  "Lucknow",
  "Ludhiana",
  "Madurai",
  "Mangaluru",
  "Mumbai",
  "Mysuru",
  "Nagpur",
  "Nashik",
  "Navi Mumbai",
  "Noida",
  "Patna",
  "Puducherry",
  "Pune",
  "Raipur",
  "Rajkot",
  "Ranchi",
  "Shillong",
  "Shimla",
  "Surat",
  "Thane",
  "Thiruvananthapuram",
  "Udaipur",
  "Vadodara",
  "Varanasi",
  "Vijayawada",
  "Visakhapatnam",
  "Abu Dhabi",
  "Amsterdam",
  "Bangkok",
  "Berlin",
  "Colombo",
  "Dhaka",
  "Doha",
  "Dubai",
  "Kathmandu",
  "London",
  "Melbourne",
  "New York",
  "Paris",
  "Singapore",
  "Sydney",
  "Toronto",
];

/** Case-insensitive search: names starting with the query first, then containing it. */
export function searchCities(query: string, limit = 8): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts = CITIES.filter((c) => c.toLowerCase().startsWith(q));
  const contains = CITIES.filter((c) => !c.toLowerCase().startsWith(q) && c.toLowerCase().includes(q));
  return [...starts, ...contains].slice(0, limit);
}

/** Tidy free text: collapse spaces, trim, cut to a length. */
export const tidy = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

/** Adds an item if it is new (case-insensitive) and the list has room. */
export function addUnique(list: string[], item: string, max: number, maxLen: number): string[] {
  const v = tidy(item, maxLen);
  if (!v || list.length >= max || list.some((x) => x.toLowerCase() === v.toLowerCase())) return list;
  return [...list, v];
}

/** Stored detail fields, as the database columns are named. */
export interface DetailFields {
  gender: Gender | null;
  show_me: ShowMe | null;
  height_cm: number | null;
  job: string | null;
  education: Education | null;
  exercise: Exercise | null;
  smoking: Smoking | null;
  children: Children | null;
  city: string | null;
  neighbourhoods: string[];
  favourite_places: string[];
  prompts: Prompt[];
}

export const EMPTY_DETAILS: DetailFields = {
  gender: null,
  show_me: null,
  height_cm: null,
  job: null,
  education: null,
  exercise: null,
  smoking: null,
  children: null,
  city: null,
  neighbourhoods: [],
  favourite_places: [],
  prompts: [],
};

export type DetailErrors = Partial<Record<keyof DetailFields, string>>;

const inSet = <T extends string>(labels: Record<T, string>, v: unknown): v is T =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(labels, v);

/** Cleans and checks details exactly like the database will. */
export function validateDetails(
  d: DetailFields,
): { ok: true; row: DetailFields } | { ok: false; errors: DetailErrors } {
  const errors: DetailErrors = {};
  const job = d.job ? tidy(d.job, 60) : "";
  const city = d.city ? tidy(d.city, 60) : "";
  const prompts = d.prompts.map((p) => ({ q: tidy(p.q, 120), a: p.a.trim() })).filter((p) => p.q && p.a);

  if (d.gender !== null && !inSet(GENDER_LABELS, d.gender)) errors.gender = "Pick one of the options.";
  if (d.show_me !== null && !inSet(SHOW_ME_LABELS, d.show_me)) errors.show_me = "Pick one of the options.";
  if (d.height_cm !== null && (!Number.isInteger(d.height_cm) || d.height_cm < 120 || d.height_cm > 230)) {
    errors.height_cm = "Enter a height between 120 and 230 cm.";
  }
  if (d.education !== null && !inSet(EDUCATION_LABELS, d.education))
    errors.education = "Pick one of the options.";
  if (d.exercise !== null && !inSet(EXERCISE_LABELS, d.exercise))
    errors.exercise = "Pick one of the options.";
  if (d.smoking !== null && !inSet(SMOKING_LABELS, d.smoking)) errors.smoking = "Pick one of the options.";
  if (d.children !== null && !inSet(CHILDREN_LABELS, d.children))
    errors.children = "Pick one of the options.";
  if (city && city.length < 2) errors.city = "Enter a city name.";
  if (d.neighbourhoods.length > MAX_NEIGHBOURHOODS) {
    errors.neighbourhoods = `Pick up to ${MAX_NEIGHBOURHOODS} neighbourhoods.`;
  }
  if (d.favourite_places.length > MAX_PLACES) errors.favourite_places = `Pick up to ${MAX_PLACES} places.`;
  if (prompts.length > MAX_PROMPTS) errors.prompts = `Answer up to ${MAX_PROMPTS} prompts.`;
  else if (prompts.some((p) => p.a.length > PROMPT_ANSWER_MAX)) {
    errors.prompts = `Keep each answer under ${PROMPT_ANSWER_MAX} characters.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    row: {
      ...d,
      job: job || null,
      city: city || null,
      neighbourhoods: d.neighbourhoods.map((n) => tidy(n, 40)).filter(Boolean),
      favourite_places: d.favourite_places.map((p) => tidy(p, 60)).filter(Boolean),
      prompts,
    },
  };
}

/** Reads detail fields from a profile row (missing columns become empty). */
export function detailsFromRow(
  row: Partial<Record<keyof DetailFields, unknown>> | null | undefined,
): DetailFields {
  const r = row ?? {};
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const prompts = Array.isArray(r.prompts)
    ? (r.prompts as unknown[]).flatMap((p) =>
        p &&
        typeof p === "object" &&
        typeof (p as Prompt).q === "string" &&
        typeof (p as Prompt).a === "string"
          ? [{ q: (p as Prompt).q, a: (p as Prompt).a }]
          : [],
      )
    : [];
  return {
    gender: inSet(GENDER_LABELS, r.gender) ? r.gender : null,
    show_me: inSet(SHOW_ME_LABELS, r.show_me) ? r.show_me : null,
    height_cm: typeof r.height_cm === "number" ? r.height_cm : null,
    job: typeof r.job === "string" ? r.job : null,
    education: inSet(EDUCATION_LABELS, r.education) ? r.education : null,
    exercise: inSet(EXERCISE_LABELS, r.exercise) ? r.exercise : null,
    smoking: inSet(SMOKING_LABELS, r.smoking) ? r.smoking : null,
    children: inSet(CHILDREN_LABELS, r.children) ? r.children : null,
    city: typeof r.city === "string" ? r.city : null,
    neighbourhoods: arr(r.neighbourhoods),
    favourite_places: arr(r.favourite_places),
    prompts,
  };
}

/** Short facts for a profile card, only for fields the person filled in. */
export function profileFacts(d: DetailFields): string[] {
  const out: string[] = [];
  if (d.height_cm) out.push(`${d.height_cm} cm`);
  if (d.job) out.push(d.job);
  if (d.education) out.push(EDUCATION_LABELS[d.education]);
  if (d.exercise) out.push(`Exercise: ${EXERCISE_LABELS[d.exercise].toLowerCase()}`);
  if (d.smoking) out.push(SMOKING_LABELS[d.smoking]);
  if (d.children) out.push(CHILDREN_LABELS[d.children]);
  return out;
}

/** Height from a slider value, shown in cm and feet/inches. */
export function heightLabel(cm: number): string {
  const totalIn = Math.round(cm / 2.54);
  return `${cm} cm (${Math.floor(totalIn / 12)}′${totalIn % 12}″)`;
}
