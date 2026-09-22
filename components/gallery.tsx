"use client";
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ImageIcon,
  X,
} from "lucide-react";
import PublicHeader from "@/components/public-header";
import { publicCopy, usePublicLanguage } from "@/components/public-language";
import PublicFooter from "@/components/public-footer";
import PublicChat from "@/components/public-chat";
import type { Tournament } from "@/types/app";
import { clientApi } from "@/lib/api-client";

type GalleryPhoto = {
  id: string;
  name: string;
  url: string;
  thumbnailUrl: string;
};
function normalizePhoto(item: Record<string, unknown>, index: number): GalleryPhoto | null {
  const id = String(item.id || item.fileId || "");
  if (!id) return null;
  return {
    id,
    name: String(item.name || item.title || `Tournament photo ${index + 1}`),
    url: String(item.url || `/api/gallery/image?id=${encodeURIComponent(id)}`),
    thumbnailUrl: String(
      item.thumbnailUrl ||
        `/api/gallery/image?id=${encodeURIComponent(id)}&thumbnail=1`,
    ),
  };
}

export default function Gallery() {
  const { language } = usePublicLanguage();
  const copy = publicCopy[language];
  const [t, setT] = useState<Tournament>({ id: "" }),
    [photos, setPhotos] = useState<GalleryPhoto[]>([]),
    [settingsLoading, setSettingsLoading] = useState(true),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [selectedIndex, setSelectedIndex] = useState<number | null>(null),
    [fullImageLoaded, setFullImageLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([
      clientApi("/tournaments"),
      clientApi("/gallery"),
    ])
      .then(([tournaments, gallery]) => {
        if (!active) return;
        if (Array.isArray(tournaments))
          setT((tournaments.find((v: Tournament) => v.active) || tournaments[0] || { id: "" }) as Tournament);
          const items = Array.isArray(gallery)
              ? gallery
              : Array.isArray(gallery.photos)
                ? gallery.photos
                : [],
            normalized = items
              .map(normalizePhoto)
              .filter(Boolean) as GalleryPhoto[];
          setPhotos(normalized);
          if (!normalized.length)
            setError("No tournament photos have been published yet.");
      })
      .catch((reason) =>
        setError(
          reason?.message ||
            "The media gallery could not be loaded. Please try again shortly.",
        ),
      )
      .finally(() => {
        if (!active) return;
        setSettingsLoading(false);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const selected = selectedIndex === null ? null : photos[selectedIndex],
    preload = (photo: GalleryPhoto) => {
      const image = new Image();
      image.src = photo.url;
    },
    move = (direction: -1 | 1) =>
      setSelectedIndex((index) => {
        if (index === null || photos.length < 2) return index;
        return (index + direction + photos.length) % photos.length;
      }),
    previous = () => move(-1),
    next = () => move(1);
  useEffect(() => {
    setFullImageLoaded(false);
  }, [selected?.id]);
  useEffect(() => {
    if (selectedIndex === null) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedIndex(null);
      if (event.key === "ArrowLeft") previous();
      if (event.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = oldOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [selectedIndex, photos.length]);
  useEffect(() => {
    if (selectedIndex === null || photos.length < 2) return;
    const adjacent = [
      photos[(selectedIndex - 1 + photos.length) % photos.length],
      photos[(selectedIndex + 1) % photos.length],
    ];
    adjacent.forEach((photo) => {
      const image = new Image();
      image.src = photo.url;
    });
  }, [selectedIndex, photos]);
  return (
    <>
      <PublicHeader settings={t} currentPath="/gallery" loading={settingsLoading} />
      <main className="public about-page gallery-page">
        <div className="pagehero">
          <span>PCF BATTLE</span>
          <h1>{copy.media}</h1>
          <p>{copy.mediaIntro}</p>
        </div>
        {loading ? (
          <div
            className="gallery-grid gallery-loading"
            aria-label="Loading gallery"
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <span key={i} />
            ))}
          </div>
        ) : photos.length ? (
          <div className="gallery-grid">
            {photos.map((photo, index) => (
              <button
                type="button"
                key={photo.id}
                onClick={() => setSelectedIndex(index)}
                onPointerEnter={() => preload(photo)}
                onFocus={() => preload(photo)}
                onTouchStart={() => preload(photo)}
                aria-label={`Open ${photo.name}`}
              >
                <img src={photo.thumbnailUrl} alt={photo.name} loading="lazy" />
                <span>{photo.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <section className="panel gallery-external">
            <ImageIcon />
            <h3>{copy.tournamentMedia}</h3>
            <p>{error || "The gallery will be available soon."}</p>
          </section>
        )}
      </main>
      <PublicFooter />
      <PublicChat />
      {selected && (
        <div
          className="gallery-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={selected.name}
          onClick={() => setSelectedIndex(null)}
        >
          <div className="gallery-toolbar" onClick={(e) => e.stopPropagation()}>
            <span>
              <b>{selected.name}</b>
              <small>
                {(selectedIndex || 0) + 1} / {photos.length}
              </small>
            </span>
            <a href={`${selected.url}${selected.url.includes("?") ? "&" : "?"}download=1`} download={selected.name}>
              <Download /> Download
            </a>
            <button
              type="button"
              className="gallery-close"
              onClick={() => setSelectedIndex(null)}
              aria-label={copy.closePhoto}
            >
              <X />
            </button>
          </div>
          <div
            className="gallery-stage"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {photos.length > 1 && (
              <>
              <button
                type="button"
                className="gallery-arrow gallery-prev"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  previous();
                }}
                aria-label={copy.previousPhoto}
              >
                <ChevronLeft />
              </button>
              <button
                type="button"
                className="gallery-arrow gallery-next"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  next();
                }}
                aria-label={copy.nextPhoto}
              >
                <ChevronRight />
              </button>
              </>
            )}
            <img
              className={`gallery-preview-image ${fullImageLoaded ? "is-replaced" : ""}`}
              src={selected.thumbnailUrl}
              alt=""
              aria-hidden="true"
            />
            <img
              className={`gallery-full-image ${fullImageLoaded ? "is-loaded" : ""}`}
              key={selected.id}
              src={selected.url}
              alt={selected.name}
              onLoad={() => setFullImageLoaded(true)}
              fetchPriority="high"
              decoding="async"
            />
          </div>
        </div>
      )}
    </>
  );
}
