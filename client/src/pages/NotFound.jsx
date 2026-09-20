import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="container">
      <h1>Not found</h1>
      <Link to="/">Go home</Link>
    </div>
  );
}
