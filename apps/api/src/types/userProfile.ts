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
};
