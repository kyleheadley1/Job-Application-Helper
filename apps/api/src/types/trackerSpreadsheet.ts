/** Spreadsheet-facing tracker fields (camelCase in Mongo); export maps to exact column labels. */
export type TrackerSpreadsheetFields = {
  rank: string;
  discussed: string;
  company: string;
  role: string;
  latestScore: string;
  originalAltScore: string;
  priority: string;
  recommendedAction: string;
  statusOutcome: string;
  salaryAsk: string;
  jdInput: string;
  topMatch: string;
  mainRisk: string;
  notes: string;
  resume: string;
  agencyCompanyName?: string;
  employerCompanyName?: string;
  companyConfidence?: string;
  companyExtractionNotes?: string;
};

export type JobImportSource = {
  spreadsheetPath: string;
  sheetName: string;
  rowNumber: number;
  fileFingerprint: string;
};
