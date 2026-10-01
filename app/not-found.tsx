import Link from "next/link";
import PublicFooter from "@/components/public-footer";
import PublicHeader from "@/components/public-header";

// The 404 page has no tournament data, so only link to sections that are always
// public; tournament, livestream and media may be unpublished.
const navigationSettings = {
  show_tournament: 0,
  show_about: 1,
  show_livestream: 0,
  show_gallery: 0,
};

export default function NotFound() {
  return (
    <>
      <PublicHeader settings={navigationSettings} currentPath="" />
      <main className="public legal-page not-found-page" aria-labelledby="not-found-title">
        <div className="pagehero">
          <span>PCF BATTLE</span>
          <h1 id="not-found-title">Page not found</h1>
          <p>The page you are looking for does not exist or may have moved.</p>
        </div>
        <section className="block not-found-content">
          <h2>Find your way back</h2>
          <p>Use the button below to return to the Powerchair Floorball Battle homepage.</p>
          <nav className="not-found-links" aria-label="Helpful links">
            <Link className="btn primary" href="/">Go to homepage</Link>
          </nav>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
