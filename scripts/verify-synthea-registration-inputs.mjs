#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const pinsPath = resolve(flag("--pins") ?? `${ROOT}/data/synthea/registration-inputs.json`);
const jarPath = resolve(flag("--jar") ?? `${ROOT}/data/synthea/synthea-with-dependencies.jar`);
const keepModulePath = resolve(
  flag("--keep-module") ?? `${ROOT}/data/synthea/modules/keep_registration_indication.json`,
);

const sha256 = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

const pins = JSON.parse(readFileSync(pinsPath, "utf8"));
if (pins.syntheticOnly !== true)
  throw new Error("registration-inputs.json must declare syntheticOnly=true");

const checks = [
  ["Synthea JAR", jarPath, pins.synthea?.sha256],
  ["Keep Module", keepModulePath, pins.keepModule?.sha256],
];
for (const [label, path, expected] of checks) {
  if (typeof expected !== "string" || !/^[0-9a-f]{64}$/.test(expected))
    throw new Error(`${label} pin is missing or is not a SHA-256 digest`);
  const actual = sha256(path);
  if (actual !== expected)
    throw new Error(`${label} digest mismatch: expected ${expected}, got ${actual}`);
  console.log(`${label} SHA-256 ${actual}`);
}
