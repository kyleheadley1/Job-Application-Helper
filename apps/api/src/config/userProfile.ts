import fs from "node:fs";
import path from "node:path";
import { resumeContextDir } from "./resumeContext.js";
import { exampleUserProfile } from "./userProfile.example.js";
import type { UserProfile } from "../types/userProfile.js";

export const userProfilePath = path.join(resumeContextDir, "user_profile.json");

const REQUIRED_KEYS: Array<keyof UserProfile> = [
  "headline",
  "strengths",
  "weakerAreas",
  "degreeStatus",
  "training",
  "targetRoles",
  "locationPreferences",
  "flagshipProjects",
  "recurringStory",
  "hardConstraints",
  "requiresSponsorship",
];

const loadUserProfile = (): UserProfile => {
  // Tests calibrate against the example profile; a personal profile must not change them.
  if (process.env.VITEST) return exampleUserProfile;
  if (!fs.existsSync(userProfilePath)) {
    console.warn(`[profile] ${userProfilePath} not found; scoring against the example profile.`);
    return exampleUserProfile;
  }
  const parsed = JSON.parse(fs.readFileSync(userProfilePath, "utf8")) as UserProfile;
  const missing = REQUIRED_KEYS.filter((key) => parsed[key] === undefined);
  if (missing.length) {
    throw new Error(`${userProfilePath} is missing required keys: ${missing.join(", ")}`);
  }
  return parsed;
};

export const userProfile: UserProfile = loadUserProfile();
