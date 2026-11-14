/**
 * SYNTHETIC demo dataset — Houston CBD office buildings.
 *
 * Building names are fictional on purpose: pairing real towers with invented
 * numbers would read as claims about real properties. When the CoStar
 * integration is live, `property.added` events carry real records instead.
 *
 * Plausibility notes
 * - Lots are roughly one downtown Houston block (250' × 250' ≈ 62,500 sf) ± half a block.
 * - Surface stalls are estimated at 320 sf per stall (stall + aisle share), see `SF_PER_STALL`.
 * - Total parking lands at ~2.2–2.5 stalls / 1,000 sf RBA, typical for CBD office.
 * - Garage stalls come from Matterport scans (9 buildings) or, where no scan
 *   exists, CoStar parking notes (3 buildings, flagged as inferred).
 * - Off-site leased spaces come from CoStar parking notes, except for 3
 *   buildings where they are unknown → evidence gaps filled by interviews.
 */
import type { PropertyInfo } from "../types";

export const SF_PER_STALL = 320;

export interface SyntheticBuilding {
  info: PropertyInfo;
  yearBuilt: number;
  rbaSf: number;
  lotSf: number;
  surfaceSf: number;
  /** Vision-model confidence for the surface-lot segmentation. */
  surfaceConfidence: number;
  garageLevels: number;
  garageStalls: number;
  /** true = counted in a Matterport scan; false = inferred from CoStar notes. */
  garageFromScan: boolean;
  offsiteSpaces: number;
  /** Where the off-site count comes from. */
  offsiteSource: "costar" | "interview";
}

const b = (
  info: Omit<PropertyInfo, "propertyClass" | "occupancyPct"> &
    Partial<Pick<PropertyInfo, "propertyClass" | "occupancyPct">>,
  d: Omit<SyntheticBuilding, "info">,
): SyntheticBuilding => ({
  info: { propertyClass: "A", occupancyPct: 85, ...info },
  ...d,
});

export const BUILDINGS: SyntheticBuilding[] = [
  // ── Pre-1980 ────────────────────────────────────────────────
  b(
    { id: "B-01", costarId: "1084-221", name: "Fannin Center", address: "900 Fannin St", lat: 29.7571, lng: -95.3641, occupancyPct: 84, contactRole: "Property manager" },
    { yearBuilt: 1974, rbaSf: 1_096_000, lotSf: 88_200, surfaceSf: 36_100, surfaceConfidence: 0.88, garageLevels: 0, garageStalls: 0, garageFromScan: true, offsiteSpaces: 2_400, offsiteSource: "interview" },
  ),
  b(
    { id: "B-02", costarId: "1084-305", name: "Louisiana Place", address: "700 Louisiana St", lat: 29.7604, lng: -95.3661, occupancyPct: 88 },
    { yearBuilt: 1975, rbaSf: 1_400_000, lotSf: 96_000, surfaceSf: 31_400, surfaceConfidence: 0.91, garageLevels: 1, garageStalls: 260, garageFromScan: true, offsiteSpaces: 2_800, offsiteSource: "costar" },
  ),
  b(
    { id: "B-03", costarId: "1085-017", name: "Smith Street Tower", address: "1200 Smith St", lat: 29.7566, lng: -95.3699, occupancyPct: 79, contactRole: "Building engineer" },
    { yearBuilt: 1978, rbaSf: 995_000, lotSf: 72_500, surfaceSf: 27_900, surfaceConfidence: 0.86, garageLevels: 0, garageStalls: 0, garageFromScan: true, offsiteSpaces: 2_150, offsiteSource: "interview" },
  ),
  b(
    { id: "B-04", costarId: "1083-940", name: "Walker Plaza", address: "910 Louisiana St", lat: 29.7592, lng: -95.3672, occupancyPct: 82 },
    { yearBuilt: 1971, rbaSf: 1_230_000, lotSf: 62_500, surfaceSf: 23_800, surfaceConfidence: 0.9, garageLevels: 2, garageStalls: 540, garageFromScan: true, offsiteSpaces: 2_300, offsiteSource: "costar" },
  ),
  b(
    { id: "B-05", costarId: "1083-962", name: "Rusk Building", address: "777 Walker St", lat: 29.7586, lng: -95.3651, propertyClass: "B", occupancyPct: 76 },
    { yearBuilt: 1971, rbaSf: 565_000, lotSf: 47_000, surfaceSf: 16_900, surfaceConfidence: 0.87, garageLevels: 0, garageStalls: 0, garageFromScan: true, offsiteSpaces: 1_310, offsiteSource: "costar" },
  ),
  b(
    { id: "B-06", costarId: "1084-002", name: "Dallas Street Center", address: "500 Dallas St", lat: 29.7582, lng: -95.3714, occupancyPct: 81 },
    { yearBuilt: 1972, rbaSf: 993_000, lotSf: 70_000, surfaceSf: 24_500, surfaceConfidence: 0.89, garageLevels: 1, garageStalls: 300, garageFromScan: false, offsiteSpaces: 1_790, offsiteSource: "costar" },
  ),
  // ── Post-2000 ───────────────────────────────────────────────
  b(
    { id: "B-07", costarId: "1102-118", name: "Capitol Square", address: "800 Capitol St", lat: 29.7611, lng: -95.3638, occupancyPct: 93 },
    { yearBuilt: 2019, rbaSf: 1_430_000, lotSf: 81_300, surfaceSf: 4_200, surfaceConfidence: 0.93, garageLevels: 9, garageStalls: 3_150, garageFromScan: true, offsiteSpaces: 0, offsiteSource: "costar" },
  ),
  b(
    { id: "B-08", costarId: "1096-450", name: "Bagby Tower", address: "1500 Louisiana St", lat: 29.7556, lng: -95.3683, occupancyPct: 90, contactRole: "Parking operator" },
    { yearBuilt: 2002, rbaSf: 1_170_000, lotSf: 64_000, surfaceSf: 6_800, surfaceConfidence: 0.92, garageLevels: 7, garageStalls: 2_450, garageFromScan: true, offsiteSpaces: 350, offsiteSource: "interview" },
  ),
  b(
    { id: "B-09", costarId: "1101-077", name: "Main & Texas", address: "609 Main St", lat: 29.7602, lng: -95.3622, occupancyPct: 91 },
    { yearBuilt: 2017, rbaSf: 1_056_000, lotSf: 62_500, surfaceSf: 5_000, surfaceConfidence: 0.94, garageLevels: 8, garageStalls: 2_300, garageFromScan: true, offsiteSpaces: 0, offsiteSource: "costar" },
  ),
  b(
    { id: "B-10", costarId: "1102-131", name: "Milam Tower", address: "811 Milam St", lat: 29.762, lng: -95.3648, occupancyPct: 89 },
    { yearBuilt: 2019, rbaSf: 778_000, lotSf: 50_000, surfaceSf: 6_100, surfaceConfidence: 0.9, garageLevels: 10, garageStalls: 1_900, garageFromScan: true, offsiteSpaces: 0, offsiteSource: "costar" },
  ),
  b(
    { id: "B-11", costarId: "1099-260", name: "Travis Place", address: "811 Travis St", lat: 29.7577, lng: -95.3626, occupancyPct: 87 },
    { yearBuilt: 2011, rbaSf: 972_000, lotSf: 62_500, surfaceSf: 7_200, surfaceConfidence: 0.91, garageLevels: 9, garageStalls: 2_190, garageFromScan: false, offsiteSpaces: 0, offsiteSource: "costar" },
  ),
  b(
    { id: "B-12", costarId: "1098-814", name: "McKinney Center", address: "1501 McKinney St", lat: 29.7548, lng: -95.366, occupancyPct: 86 },
    { yearBuilt: 2010, rbaSf: 845_000, lotSf: 58_000, surfaceSf: 8_400, surfaceConfidence: 0.9, garageLevels: 6, garageStalls: 1_600, garageFromScan: false, offsiteSpaces: 360, offsiteSource: "costar" },
  ),
];

export const STUDY = {
  id: "study-014",
  question: "Do older office buildings in Houston dedicate more land to surface parking?",
  hypothesis: "Pre-1980 offices devote a larger share of their lot to surface parking than newer ones.",
  sample: "12 Houston CBD offices · 6 built before 1980, 6 built after 2000",
  preCutoff: 1980,
  postCutoff: 2000,
} as const;

/** Interview scripts for the three evidence gaps. Deterministic. */
export interface InterviewScript {
  interviewId: string;
  propertyId: string;
  contact: string;
  answer: number;
  confidence: number;
  quoteT: number;
  utterances: { speaker: "agent" | "contact"; text: string; t: number; highlight?: string }[];
  /** index of the question each utterance answers/asks — drives progress */
  questionAnswers: [string, string, string];
}

export const INTERVIEW_QUESTIONS = [
  { text: "Does the building provide tenant parking off-site or in a shared garage? About how many spaces?", maps: "offsiteSpaces" as const },
  { text: "At peak, roughly what share of the surface lot fills up?", maps: "context" as const },
  { text: "Any plans to redevelop or reduce the surface lot?", maps: "context" as const },
];

export const INTERVIEWS: InterviewScript[] = [
  {
    interviewId: "iv-01",
    propertyId: "B-01",
    contact: "Property manager",
    answer: 2_400,
    confidence: 0.94,
    quoteT: 12,
    questionAnswers: ["≈2,400 leased spaces", "≈90% at peak", "No current plans"],
    utterances: [
      { speaker: "agent", t: 0, text: "Hi, I'm UrbanLab's research assistant. I have three quick questions about parking at Fannin Center, and the call is recorded for research. Is that okay?" },
      { speaker: "contact", t: 4, text: "Sure, go ahead." },
      { speaker: "agent", t: 6, text: "Does the building provide tenant parking off-site or in a shared garage? About how many spaces?" },
      { speaker: "contact", t: 12, text: "Yes, tenants mostly park off-site. We lease about 2,400 spaces in the garage across Fannin.", highlight: "2,400 spaces" },
      { speaker: "agent", t: 19, text: "Thanks. At peak, roughly what share of the surface lot fills up?" },
      { speaker: "contact", t: 23, text: "It's close to full by nine, maybe ninety percent." },
      { speaker: "agent", t: 27, text: "Last one: any plans to redevelop or reduce the surface lot?" },
      { speaker: "contact", t: 31, text: "Nothing on the books right now." },
      { speaker: "agent", t: 34, text: "That's everything. Thank you for your time!" },
    ],
  },
  {
    interviewId: "iv-03",
    propertyId: "B-03",
    contact: "Building engineer",
    answer: 2_150,
    confidence: 0.9,
    quoteT: 10,
    questionAnswers: ["≈2,150 contract spaces", "≈75% at peak", "Studying a garage"],
    utterances: [
      { speaker: "agent", t: 0, text: "Hi, I'm UrbanLab's research assistant calling about parking at Smith Street Tower. The call is recorded for research. Okay to continue?" },
      { speaker: "contact", t: 3, text: "Yeah, that's fine." },
      { speaker: "agent", t: 5, text: "Does the building provide tenant parking off-site or in a shared garage? About how many spaces?" },
      { speaker: "contact", t: 10, text: "We have a contract for roughly 2,150 spaces in the Allen Center garages.", highlight: "2,150 spaces" },
      { speaker: "agent", t: 15, text: "At peak, roughly what share of the surface lot fills up?" },
      { speaker: "contact", t: 18, text: "Three quarters, give or take." },
      { speaker: "agent", t: 21, text: "Any plans to redevelop or reduce the surface lot?" },
      { speaker: "contact", t: 24, text: "Ownership is studying a garage on that site." },
    ],
  },
  {
    interviewId: "iv-08",
    propertyId: "B-08",
    contact: "Parking operator",
    answer: 350,
    confidence: 0.88,
    quoteT: 9,
    questionAnswers: ["≈350 overflow spaces", "Small lot, ≈60%", "No plans"],
    utterances: [
      { speaker: "agent", t: 0, text: "Hi, I'm UrbanLab's research assistant with three quick questions about parking at Bagby Tower. This call is recorded for research. Is that alright?" },
      { speaker: "contact", t: 3, text: "Go ahead." },
      { speaker: "agent", t: 5, text: "Does the building provide tenant parking off-site or in a shared garage? About how many spaces?" },
      { speaker: "contact", t: 9, text: "Mostly our own garage, plus about 350 overflow spaces in a lot on Bagby.", highlight: "350 overflow spaces" },
      { speaker: "agent", t: 14, text: "At peak, roughly what share of the surface lot fills up?" },
      { speaker: "contact", t: 17, text: "It's a small lot, about sixty percent." },
      { speaker: "agent", t: 20, text: "Any plans to redevelop or reduce it?" },
      { speaker: "contact", t: 23, text: "No, nothing planned." },
    ],
  },
];
