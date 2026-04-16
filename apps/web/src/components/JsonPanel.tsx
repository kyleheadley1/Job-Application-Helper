export const JsonPanel = ({ value }: { value: unknown }) => (
  <pre className="jsonPanel">{JSON.stringify(value, null, 2)}</pre>
);
