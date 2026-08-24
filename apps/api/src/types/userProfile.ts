export type UserCertification = {
  name: string;
  issuer: string;
  status: "active" | "lapsed";
  relatedSkills: string[];
};

export type UserProfile = {
  headline: string;
  strengths: string[];
  weakerAreas: string[];
  degreeStatus: {
    hasBachelors: boolean;
    note: string;
  };
  training: {
    program: string;
    completionDate: string;
  };
  targetRoles: string[];
  locationPreferences: {
    primary: string[];
    acceptable: string[];
    usuallyNo: string[];
  };
  flagshipProjects: Array<{
    name: string;
    summary: string;
    tech: string[];
    outcomes: string[];
  }>;
  recurringStory: string[];
  hardConstraints: string[];
  /**
   * Approximate professional YOE for Level-fit / reinforced experience-floor docks.
   * Do not invent this at score time — keep it as an explicit profile hint.
   */
  estimatedProfessionalYears?: number;
  /** When false, JD "no sponsorship" / work-auth language is not treated as a gate for this candidate. */
  requiresSponsorship: boolean;
  citizenshipStatus?: {
    isUSCitizen: boolean;
  };
  /** True only when the candidate currently holds an active clearance. */
  holdsActiveClearance?: boolean;
  /** Structured home base for geo eligibility checks. */
  candidateLocation?: {
    label: string;
    basedInUS?: boolean;
    regions?: string[];
  };
  certifications?: UserCertification[];
};
