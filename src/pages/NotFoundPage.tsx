import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ZeroMark } from '../components/brand/ZeroMark';
import { Icon } from '../components/ui/Icon';

export function NotFoundPage() {
  useDocumentTitle('Page not found');

  return (
    <main id="main" className="page">
      <div className="fourohfour">
        <ZeroMark size={72} />
        <span className="eyebrow">404 · page not found</span>
        <h1>There is nothing at this address.</h1>
        <p>
          The page may have moved, or the tool may not exist yet. Your files were never involved in this —
          nothing was uploaded to produce this error.
        </p>
        <div className="row row--wrap" style={{ justifyContent: 'center' }}>
          <Link to="/" className="btn btn--secondary">
            <Icon name="arrow-left" size={14} /> Home
          </Link>
          <Link to="/tools" className="btn btn--primary">
            Browse tools <Icon name="arrow-right" size={14} />
          </Link>
        </div>
      </div>
    </main>
  );
}
