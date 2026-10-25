import React, { useEffect, useRef, useState, useCallback } from 'react';

/*
 * Interactive 3D card spinner for the deck/lightbox view.
 * Grab the image horizontally to spin around the Y axis.
 * Pokemon cards show a real card-back design when spun around.
 * Shows a strip of related (same-name) cards below the main image.
 * If released within 10° of front-facing, snaps smoothly back.
 * Only closes when you do a clean click-release on the dark backdrop.
 */
export default function ImageLightbox({ src, alt, images = [], onClose, cardId, related = [], onNavigate, pokeBack = false }) {
  const rafRef = useRef(null);
  const suppressClose = useRef(false);
  const idleTimerRef = useRef(null);
  const IDLE_MS = 2000;

  const initialIndex = images.length > 0
    ? Math.max(0, images.findIndex((img) => `/images/${img.filename}` === src))
    : 0;
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const active = images[activeIndex] || null;
  const activeSrc = active ? `/images/${active.filename}` : src;
  const activeAlt = active ? active.side : alt;

  const [rotation, setRotation] = useState({ y: 6 });
  const rotationRef = useRef({ y: 6 });
  useEffect(() => { rotationRef.current = rotation; }, [rotation]);

  const [isDragging, setIsDragging] = useState(false);

  const physics = useRef({
    vel: 0,
    lastX: 0,
    lastTime: 0,
    friction: 0.96,
    minVel: 0.05,
    didMove: false,
  });

  const stopAnim = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  function resetIdleTimer() {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      const curr = rotationRef.current.y;
      const nearest = Math.round(curr / 360) * 360;
      startSnap(nearest);
    }, IDLE_MS);
  }

  const startSnap = useCallback((targetY) => {
    stopAnim();
    const loop = () => {
      const currY = rotationRef.current.y;
      const d = targetY - currY;
      if (Math.abs(d) < 0.06) {
        rotationRef.current = { y: targetY };
        setRotation({ y: targetY });
        rafRef.current = null;
        return;
      }
      const next = { y: currY + d * 0.10 };
      rotationRef.current = next;
      setRotation(next);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [stopAnim]);

  const startInertia = useCallback(() => {
    stopAnim();
    const loop = () => {
      const p = physics.current;
      if (Math.abs(p.vel) < p.minVel) {
        p.vel = 0;
        rafRef.current = null;
        return;
      }
      const next = { y: rotationRef.current.y + p.vel };
      rotationRef.current = next;
      setRotation(next);
      p.vel *= p.friction;
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [stopAnim]);

  const onPointerDown = useCallback((e) => {
    stopAnim();
    setIsDragging(true);
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const p = physics.current;
    p.lastX = clientX;
    p.lastTime = performance.now();
    p.vel = 0;
    p.didMove = false;
    suppressClose.current = false;
    resetIdleTimer();
    e.preventDefault();
  }, [stopAnim]);

  const onPointerMove = useCallback((e) => {
    if (!isDragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const now = performance.now();
    const p = physics.current;

    const dx = clientX - p.lastX;
    const dt = now - p.lastTime;
    const sensitivity = 0.35;
    const deltaY = dx * sensitivity;

    if (Math.abs(dx) > 2) p.didMove = true;

    if (dt > 0) p.vel = (deltaY / dt) * 16;

    const next = { y: rotationRef.current.y + deltaY };
    rotationRef.current = next;
    setRotation(next);

    p.lastX = clientX;
    p.lastTime = now;
    resetIdleTimer();
    e.preventDefault();
  }, [isDragging]);

  const onPointerUp = useCallback(() => {
    setIsDragging(false);
    const p = physics.current;
    const curr = rotationRef.current.y;
    const nearest = Math.round(curr / 360) * 360;
    const dist = Math.abs(curr - nearest);

    if (p.didMove) {
      suppressClose.current = true;
      setTimeout(() => { suppressClose.current = false; }, 60);
    }

    if (dist <= 10) {
      startSnap(nearest);
    } else if (Math.abs(p.vel) < p.minVel) {
      // Released too slowly to carry inertia — snap to nearest front-facing rotation
      startSnap(nearest);
    } else {
      startInertia();
    }
    resetIdleTimer();
  }, [startInertia, startSnap]);

  useEffect(() => {
    resetIdleTimer();
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      stopAnim();
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [onClose, stopAnim]);

  useEffect(() => {
    if (!isDragging) return;
    const preventScroll = (e) => e.preventDefault();
    window.addEventListener('touchmove', preventScroll, { passive: false });
    return () => window.removeEventListener('touchmove', preventScroll);
  }, [isDragging]);

  useEffect(() => {
    if (!isDragging) return;
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('touchend', onPointerUp);
    return () => {
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('mouseup', onPointerUp);
      window.removeEventListener('touchmove', onPointerMove);
      window.removeEventListener('touchend', onPointerUp);
    };
  }, [isDragging, onPointerMove, onPointerUp]);

  const cursor = isDragging ? 'grabbing' : 'grab';

  function handleBackdropClick() {
    if (suppressClose.current) return;
    onClose();
  }

  // Normalize rotation to 0-360 for deciding which face is visible
  const normY = ((rotation.y % 360) + 360) % 360;
  const showBackFace = pokeBack && (normY > 90 && normY < 270);

  return (
    <div className="camera-modal lightbox-modal" onClick={handleBackdropClick}>
      <div className="lightbox-layout" onClick={(e) => e.stopPropagation()}>
        <div
          className="lightbox-3d-card"
          style={{ cursor, touchAction: 'none' }}
          onMouseDown={onPointerDown}
          onTouchStart={onPointerDown}
        >
          <div
            className="flip-card"
            style={{
              transform: `rotateY(${rotation.y.toFixed(2)}deg)`,
              transition: isDragging ? 'none' : 'transform 0.1s ease-out',
            }}
          >
            <div className="flip-card-front">
              <img
                src={activeSrc}
                alt={activeAlt}
                draggable={false}
                style={{
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                }}
              />
            </div>
            {pokeBack && (
              <div className="flip-card-back">
                <img
                  src="/card-back.svg"
                  alt="Card back"
                  draggable={false}
                  style={{
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                  }}
                />
              </div>
            )}
          </div>
          <p className="lightbox-hint">{isDragging ? '' : 'Click & drag to spin'}</p>
        </div>

        {images.length > 1 && (
          <div className="lightbox-image-tabs">
            {images.map((img, i) => (
              <button
                key={img.id}
                className={`lightbox-tab ${i === activeIndex ? 'active' : ''}`}
                onClick={() => { setActiveIndex(i); resetIdleTimer(); }}
                title={img.side}
              >
                <img src={`/images/${img.filename}`} alt={img.side} />
                <span>{img.side}</span>
              </button>
            ))}
          </div>
        )}

        {related.filter((r) => r.id !== cardId).length > 0 && (
          <div className="lightbox-related">
            <p className="lightbox-related-label">Other versions in collection:</p>
            <div className="lightbox-related-strip">
              {related.filter((r) => r.id !== cardId).map((r) => (
                <div key={r.id} className="lightbox-related-card">
                  {r.image ? (
                    <img
                      src={r.image}
                      alt={r.player_or_character || r.set_name}
                      loading="lazy"
                      onClick={() => { onClose(); onNavigate(r.id); }}
                    />
                  ) : (
                    <div className="lightbox-related-noimg">?</div>
                  )}
                  <button className="btn small" onClick={() => onNavigate(r.id)}>View</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <button className="btn lightbox-close" onClick={(e) => { e.stopPropagation(); onClose(); }}>✕</button>
    </div>
  );
}
