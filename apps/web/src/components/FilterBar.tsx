type Props = {
  status: string;
  onStatusChange: (value: string) => void;
  company: string;
  onCompanyChange: (value: string) => void;
  resume: string;
  onResumeChange: (value: string) => void;
  recommendation: string;
  onRecommendationChange: (value: string) => void;
  minScore: string;
  onMinScoreChange: (value: string) => void;
  fromDate: string;
  onFromDateChange: (value: string) => void;
  toDate: string;
  onToDateChange: (value: string) => void;
  shortlistOnly: boolean;
  onShortlistChange: (value: boolean) => void;
};

export const FilterBar = ({
  status,
  onStatusChange,
  company,
  onCompanyChange,
  resume,
  onResumeChange,
  recommendation,
  onRecommendationChange,
  minScore,
  onMinScoreChange,
  fromDate,
  onFromDateChange,
  toDate,
  onToDateChange,
  shortlistOnly,
  onShortlistChange,
}: Props) => (
  <div className="tracker-filter-grid">
    <label>
      Status
      <select value={status} onChange={(e) => onStatusChange(e.target.value)}>
        <option value="">All</option>
        <option value="to_review">to_review</option>
        <option value="applied">applied</option>
        <option value="skip">skip</option>
        <option value="rejected">rejected</option>
        <option value="interviewing">interviewing</option>
        <option value="assessment">assessment</option>
        <option value="closed">closed</option>
        <option value="offer">offer</option>
      </select>
    </label>
    <label>
      Company
      <input value={company} onChange={(e) => onCompanyChange(e.target.value)} placeholder="Filter company" />
    </label>
    <label>
      Resume
      <select value={resume} onChange={(e) => onResumeChange(e.target.value)}>
        <option value="">All</option>
        <option value="SWE">SWE</option>
        <option value="SIE">SIE</option>
        <option value="EARLY_CAREER">EARLY_CAREER</option>
      </select>
    </label>
    <label>
      Recommendation
      <select value={recommendation} onChange={(e) => onRecommendationChange(e.target.value)}>
        <option value="">All</option>
        <option value="yes">yes</option>
        <option value="selective_yes">selective_yes</option>
        <option value="no">no</option>
      </select>
    </label>
    <label>
      Min score
      <input
        type="number"
        min={0}
        max={100}
        value={minScore}
        onChange={(e) => onMinScoreChange(e.target.value)}
        placeholder="e.g. 78"
      />
    </label>
    <label>
      From date
      <input type="date" value={fromDate} onChange={(e) => onFromDateChange(e.target.value)} />
    </label>
    <label>
      To date
      <input type="date" value={toDate} onChange={(e) => onToDateChange(e.target.value)} />
    </label>
    <label>
      Reset
      <button
        type="button"
        onClick={() => {
          onStatusChange("");
          onCompanyChange("");
          onResumeChange("");
          onRecommendationChange("");
          onMinScoreChange("");
          onFromDateChange("");
          onToDateChange("");
          onShortlistChange(false);
        }}
      >
        Clear
      </button>
    </label>
    <label className="checkboxRow tracker-filter-shortlist">
      <input type="checkbox" checked={shortlistOnly} onChange={(e) => onShortlistChange(e.target.checked)} />
      Shortlisted only
    </label>
  </div>
);
