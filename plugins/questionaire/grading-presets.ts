import type { QuestionnaireOption } from "./types";

/**
 * Pathology grading-scale presets. Pure data: each entry is a one-click option
 * list that the designer's choice-type editor can drop onto a Multiple choice /
 * Dropdown question. No schema coupling beyond `options`.
 */
export type GradingPreset = {
  id: string;
  label: string;
  options: QuestionnaireOption[];
};

const opt = (value: string, label?: string): QuestionnaireOption => ({ value, label: label ?? value });

export const GRADING_PRESETS: GradingPreset[] = [
  {
    id: "gleason",
    label: "Gleason grade group",
    options: [
      opt("gg1", "Grade group 1 (Gleason ≤6)"),
      opt("gg2", "Grade group 2 (Gleason 3+4=7)"),
      opt("gg3", "Grade group 3 (Gleason 4+3=7)"),
      opt("gg4", "Grade group 4 (Gleason 8)"),
      opt("gg5", "Grade group 5 (Gleason 9–10)"),
    ],
  },
  {
    id: "nottingham",
    label: "Nottingham (Bloom–Richardson)",
    options: [
      opt("g1", "Grade 1 — well differentiated (3–5)"),
      opt("g2", "Grade 2 — moderately differentiated (6–7)"),
      opt("g3", "Grade 3 — poorly differentiated (8–9)"),
    ],
  },
  {
    id: "tnm_t",
    label: "TNM — primary tumour (T)",
    options: [opt("Tis"), opt("T1"), opt("T2"), opt("T3"), opt("T4"), opt("TX", "TX (cannot assess)")],
  },
  {
    id: "tnm_n",
    label: "TNM — regional nodes (N)",
    options: [opt("N0"), opt("N1"), opt("N2"), opt("N3"), opt("NX", "NX (cannot assess)")],
  },
  {
    id: "tnm_m",
    label: "TNM — distant metastasis (M)",
    options: [opt("M0"), opt("M1"), opt("MX", "MX (cannot assess)")],
  },
];

export function gradingPreset(id: string): GradingPreset | undefined {
  return GRADING_PRESETS.find((p) => p.id === id);
}
