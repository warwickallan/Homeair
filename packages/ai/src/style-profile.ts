/**
 * Lightweight style profile for "More Like Me" (brief §34). Static for now;
 * later this can be derived from selected examples of the user's own sent
 * messages. Deliberately not learned from historical arguments.
 */
export type StyleProfile = {
  language: string;
  formality: string;
  directness: string;
  humour: string;
  swearing: string;
  average_length: string;
  avoid: string[];
};

export const DEFAULT_STYLE_PROFILE: StyleProfile = {
  language: "British English",
  formality: "informal",
  directness: "high",
  humour: "frequent",
  swearing: "occasional",
  average_length: "short-medium",
  avoid: ["therapy jargon", "corporate language", "overly polished prose"],
};
