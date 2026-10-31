import { Link } from 'react-router-dom';
import { usePageMeta } from '../hooks/usePageMeta';
import { ZeroMark } from '../components/brand/ZeroMark';
import { Icon } from '../components/ui/Icon';

export function NotFoundPage() {
  usePageMeta(
    {
      title: 'Page not found · ZeroUpload',
      description: 'There is no page at this address. Browse the tool catalogue to find what you need.',
      noindex: true,
    },
    '/404/',
  );

  return (
    <main id="main" className="page">
      <div className="fourohfour">
        <ZeroMark size={72} />
        <span className="eyebrow">404 · page not found</span>
        <h1>There is nothing at this address.</h1>
        <p>
          The page may have moved, or the tool may not exist yet. Nothing was uploaded, so there is nothing
          to clean up.
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
