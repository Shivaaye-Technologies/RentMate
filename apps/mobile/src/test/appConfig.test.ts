// The Android identity and build configuration. The package id is permanent once the app is on Google Play, so any
// change here must be deliberate and approved by the founder.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config, { ANDROID_PACKAGE, EAS_PROJECT_ID, EXPO_OWNER, URL_SCHEME } from "../../app.config";

const APPROVED_PACKAGE = "com.shivaayetechnologies.rentmate";
const eas = JSON.parse(readFileSync(new URL("../../eas.json", import.meta.url).pathname, "utf8")) as {
  cli: { appVersionSource?: string };
  build: Record<
    string,
    { developmentClient?: boolean; distribution?: string; android?: { buildType?: string } }
  >;
  submit: Record<string, { android?: { track?: string; releaseStatus?: string } }>;
};

describe("Android identity", () => {
  it("uses the founder-approved, permanent package id", () => {
    expect(ANDROID_PACKAGE).toBe(APPROVED_PACKAGE);
    expect(config.android?.package).toBe(APPROVED_PACKAGE);
  });

  it("the package id is a valid Android application id", () => {
    // Two or more segments, each starting with a letter, only letters, digits and underscores; lowercase by convention.
    expect(APPROVED_PACKAGE).toMatch(/^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$/);
  });

  it("cannot be overridden from the environment", () => {
    const src = readFileSync(new URL("../../app.config.ts", import.meta.url).pathname, "utf8");
    expect(src).not.toMatch(/process\\.env\\.[A-Z_]*PACKAGE/);
  });

  it("has the app name, URL scheme and Android-only platform", () => {
    expect(config.name).toBe("RentMate");
    expect(URL_SCHEME).toBe("rentmate");
    expect(config.scheme).toBe("rentmate");
    expect(config.platforms).toEqual(["android"]);
  });

  it("uses EAS remote Android versioning and does not pin a local versionCode", () => {
    expect(eas.cli.appVersionSource).toBe("remote");
    expect(config.android).not.toHaveProperty("versionCode");
  });
});

describe("EAS project link", () => {
  it("links to the founder's EAS project shivaaye-technologies/rentmate", () => {
    expect(EAS_PROJECT_ID).toBe("8b134aa5-6f2c-4741-90d9-05d03dae3662");
    expect(config.extra?.eas).toEqual({ projectId: "8b134aa5-6f2c-4741-90d9-05d03dae3662" });
    expect(EXPO_OWNER).toBe("shivaaye-technologies");
    expect(config.owner).toBe("shivaaye-technologies");
    expect(config.slug).toBe("rentmate");
  });

  it("the project id is a UUID and is not taken from the environment", () => {
    expect(EAS_PROJECT_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const src = readFileSync(new URL("../../app.config.ts", import.meta.url).pathname, "utf8");
    expect(src).not.toMatch(/process\\.env/);
  });
});

describe("Android build settings", () => {
  const buildProps = config.plugins?.find((p) => Array.isArray(p) && p[0] === "expo-build-properties") as
    [string, { android: Record<string, number> }] | undefined;

  it("compiles against API 37 (Expo SDK 58 libraries), targets API 36 (Google Play) and supports min 24", () => {
    expect(buildProps?.[1].android).toEqual({
      compileSdkVersion: 37,
      targetSdkVersion: 36,
      minSdkVersion: 24,
    });
  });

  it("requests no permissions yet and blocks camera, microphone and location until their features ship", () => {
    expect(config.android?.permissions).toEqual([]);
    for (const p of ["CAMERA", "RECORD_AUDIO", "ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"]) {
      expect(config.android?.blockedPermissions).toContain(`android.permission.${p}`);
    }
  });

  it("keeps secure session values out of backups and uses Expo Router", () => {
    expect(config.plugins).toContainEqual(["expo-secure-store", { configureAndroidBackup: true }]);
    expect(config.plugins).toContain("expo-router");
  });
});

describe("EAS build profiles", () => {
  it("development: dev-client APK for internal installs (the first device build)", () => {
    expect(eas.build.development).toMatchObject({
      developmentClient: true,
      distribution: "internal",
      android: { buildType: "apk" },
    });
  });

  it("preview: installable APK; production: signed App Bundle", () => {
    expect(eas.build.preview.android?.buildType).toBe("apk");
    expect(eas.build.production.android?.buildType).toBe("app-bundle");
  });

  it("submission would go only to the internal track as a draft (nothing is uploaded yet)", () => {
    expect(eas.submit.production.android).toEqual({ track: "internal", releaseStatus: "draft" });
  });

  it("no profile sets an application id of its own or embeds secrets", () => {
    const raw = readFileSync(new URL("../../eas.json", import.meta.url).pathname, "utf8");
    expect(raw).not.toMatch(/applicationId|package|SECRET|SERVICE_ROLE|LIVEKIT_API/i);
  });
});
