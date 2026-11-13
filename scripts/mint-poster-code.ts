// Mint a short link for a printed poster or beer mat.
//
//   npm run poster:mint -- --place red-lion-se1 --medium beermat [--campaign launch-2026-11] [--code redlion]
//
// Adds the code to lib/posterCodes.json and prints the URL for the QR. The code
// works after the next deploy.

import { randomInt } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { mintPosterCode, parsePosterCodes } from "../lib/posterCodes";

const REGISTRY_PATH = join(process.cwd(), "lib/posterCodes.json");
// No 0, o, 1, i or l, so a code read off a scuffed mat is not misread.
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 5;

function randomCode(): string {
  let code = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

const { values } = parseArgs({
  options: {
    place: { type: "string" },
    medium: { type: "string" },
    campaign: { type: "string" },
    code: { type: "string" },
  },
});

try {
  const codes = parsePosterCodes(JSON.parse(readFileSync(REGISTRY_PATH, "utf8")));
  const minted = mintPosterCode(
    codes,
    {
      place: values.place ?? "",
      medium: values.medium ?? "",
      campaign: values.campaign,
      code: values.code,
    },
    randomCode,
  );
  writeFileSync(REGISTRY_PATH, `${JSON.stringify([...codes, minted], null, 2)}\n`);
  console.log(`Minted ${minted.medium} code ${minted.code} for ${minted.place}.`);
  console.log(`QR link: https://pubmaxxing.com/get/${minted.code}`);
  console.log("Commit lib/posterCodes.json. The link counts scans after the next deploy.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("Usage: npm run poster:mint -- --place <slug> --medium poster|beermat [--campaign <slug>] [--code <slug>]");
  process.exitCode = 1;
}
