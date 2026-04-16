type Props = {
  status: string;
  onStatusChange: (value: string) => void;
  company: string;
  onCompanyChange: (value: string) => void;
  resume: string;
  onResumeChange: (value: string) => void;
  scoreBand: string;
  onScoreBandChange: (value: string) => void;
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
  scoreBand,
  onScoreBandChange,
  shortlistOnly,
  onShortlistChange,
}: Props) => (
  <div className="grid filters">
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
      Score band
      <select value={scoreBand} onChange={(e) => onScoreBandChange(e.target.value)}>
        <option value="">All</option>
        <option value="80">80+</option>
        <option value="70">70-79</option>
        <option value="65">65-69</option>
        <option value="0">Below 65</option>
      </select>
    </label>
    <label className="checkboxRow">
      <input type="checkbox" checked={shortlistOnly} onChange={(e) => onShortlistChange(e.target.checked)} />
      Shortlisted only
    </label>
  </div>
);
