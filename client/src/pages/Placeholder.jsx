// Placeholder for modules whose full UI arrives in their own phase.
// Shows an honest empty state — never fake data.
export default function Placeholder({ title, description }) {
  return (
    <div className="container wide">
      <h1>{title}</h1>
      <div className="card empty-state">
        <p className="muted">{description ?? 'This module is not built yet. It will appear here in its implementation phase.'}</p>
      </div>
    </div>
  );
}
