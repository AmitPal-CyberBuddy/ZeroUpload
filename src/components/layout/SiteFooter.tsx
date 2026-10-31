import { Link } from 'react-router-dom';
import { ZeroMark } from '../brand/ZeroMark';
import { CATEGORIES } from '../../registry/categories';

const GITHUB_URL = 'https://github.com/AmitPal-CyberBuddy/ZeroUpload';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="page">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link to="/" className="brand">
              <ZeroMark size={24} />
              <span className="brand__word">
                Zero<span>Upload</span>
              </span>
            </Link>
            <p>
              A local-first file toolkit. Convert, compress and transform files inside your browser — no
              uploads, no cloud storage, no accounts.
            </p>
            <span className="footer-signal">
              <i className="dot" aria-hidden="true" />
              All processing on-device
            </span>
          </div>

          <div className="footer-col">
            <h4>Platform</h4>
            <ul>
              <li>
                <Link to="/tools">All tools</Link>
              </li>
              {CATEGORIES.map((category) => (
                <li key={category.id}>
                  <Link to={`/tools/${category.id}`}>{category.name}</Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="footer-col">
            <h4>Tools</h4>
            <ul>
              <li>
                <Link to="/tools/image-compressor">Compress images</Link>
              </li>
              <li>
                <Link to="/tools/image-converter">Convert images</Link>
              </li>
              <li>
                <Link to="/tools/merge-pdf">Merge PDFs</Link>
              </li>
              <li>
                <Link to="/tools/file-inspector">Inspect a file</Link>
              </li>
            </ul>
          </div>

          <div className="footer-col">
            <h4>Project</h4>
            <ul>
              <li>
                <Link to="/how-it-works">How it works</Link>
              </li>
              <li>
                <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener">
                  Source code
                </a>
              </li>
              <li>
                <a href={`${GITHUB_URL}/blob/main/SECURITY.md`} target="_blank" rel="noreferrer noopener">
                  Security notes
                </a>
              </li>
              <li>
                <a href={`${GITHUB_URL}/issues`} target="_blank" rel="noreferrer noopener">
                  Report an issue
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} ZeroUpload · MIT licensed</span>
          <span className="mono" style={{ letterSpacing: '0.06em' }}>
            Your files stay on your device.
          </span>
        </div>
      </div>
    </footer>
  );
}
