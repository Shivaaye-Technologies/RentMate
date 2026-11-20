// Metro: also read the shared, pure rule modules in apps/web/src (age, attestation, account deletion, safety) in
// place, so web and Android use exactly the same rules without copies.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "../web/src")];

module.exports = config;
