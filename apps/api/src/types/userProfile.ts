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
  /** When false, JD "no sponsorship" / work-auth language is not treated as a gate for this candidate. */
  requiresSponsorship: boolean;
};
