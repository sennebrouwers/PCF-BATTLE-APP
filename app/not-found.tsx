import Link from "next/link";
import PublicFooter from "@/components/public-footer";
import PublicHeader from "@/components/public-header";

const navigationSettings = {
  show_tournament: 1,
  live_enabled: 1,
  show_matches: 1,
  show_standings: 1,
  show_brackets: 1,
  show_statistics: 1,
  show_about: 1,
  show_livestream: 1,
  show_gallery: 1,
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
          <p>Use one of these links to continue exploring the Powerchair Floorball Battle.</p>
          <nav className="not-found-links" aria-label="Helpful links">
            <Link className="btn primary" href="/">Go to homepage</Link>
            <Link className="btn" href="/tournament/schedule">View schedule</Link>
            <Link className="btn" href="/about">Practical information</Link>
            <a className="btn" href="mailto:hello@pcfbattle.be?subject=Broken%20page%20report">Report a problem</a>
          </nav>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
