import React, { useEffect, useRef, useState, useCallback } from 'react';

/*
 * Polished interactive 3D card spinner.
 *
 * Conventions followed:
 *  - Flat Y-axis rotation only (cards spin on a vertical axis)
 *  - Velocity-based X tilt during throws (bottom tips into the motion)
 *  - Spring physics for face-snaps (slight overshoot then settle)
 *  - Dynamic shadow follows rotation angle
 *  - Grab feedback: card lifts and scales up
 *  - No arbitrary idle timers; snap only on release near a face
 *  - Pokemon cards show real card-back when spun past 90°
 */
export default function ImageLightbox({
  src,
  alt,
  images = [],
  onClose,
  cardId,
  related = [],
  onNavigate,
  pokeBack = false,
}) {
  const rafRef = useRef(null);
  const suppressClose = useRef(false);

  const initialIndex = images.length > 0
    ? Math.max(0, images.findIndex((img) => `/images/${img.filename}` === src))
    : 0;
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const active = images[activeIndex] || null;
  const activeSrc = active ? `/images/${active.filename}` : src;
  const activeAlt = active ? active.side : alt;

  const [rotation, setRotation] = useState({ y: 0 });
  const rotationRef = useRef({ y: 0 });
  useEffect(() => { rotationRef.current = rotation; }, [rotation]);

  const [isDragging, setIsDragging] = useState(false);

  const physics = useRef({
    vel: 0,
    lastX: 0,
    lastTime: 0,
    didMove: false,
  });

  const stopAnim = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Spring snap: Hooke's law with damping for a satisfying settle
  const startSnap = useCallback((targetY) => {
    stopAnim();
    const STIFFNESS = 0.10;
    const DAMPING = 0.82;
    let vel = 0;
    const loop = () => {
      const curr = rotationRef.current.y;
      const d = targetY - curr;
      if (Math.abs(d) < 0.05 && Math.abs(vel) < 0.05) {
        rotationRef.current = { y: targetY };
        setRotation({ y: targetY });
        rafRef.current = null;
        return;
      }
      vel += d * STIFFNESS;
      vel *= DAMPING;
      const next = { y: curr + vel };
      rotationRef.current = next;
      setRotation(next);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [stopAnim]);

  // Heavier inertia: cards feel weightier than the old 0.96
  const startInertia = useCallback(() => {
    stopAnim();
    const FRICTION = 0.92;
    const MIN_VEL = 0.15;
    const loop = () => {
      const p = physics.current;
      if (Math.abs(p.vel) < MIN_VEL) {
        p.vel = 0;
        // Inertia finished — snap to nearest face
        const nearest = Math.round(rotationRef.current.y / 360) * 360;
        startSnap(nearest);
        return;
      }
      const next = { y: rotationRef.current.y + p.vel };
      rotationRef.current = next;
      setRotation(next);
      p.vel *= FRICTION;
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [stopAnim, startSnap]);

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
    e.preventDefault();
  }, [stopAnim]);

  const onPointerMove = useCallback((e) => {
    if (!isDragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const now = performance.now();
    const p = physics.current;

    const dx = clientX - p.lastX;
    const dt = now - p.lastTime;
    const sensitivity = 0.40;
    const deltaY = dx * sensitivity;

    if (Math.abs(dx) > 2) p.didMove = true;

    if (dt > 0) p.vel = (deltaY / dt) * 16;

    const next = { y: rotationRef.current.y + deltaY };
    rotationRef.current = next;
    setRotation(next);

    p.lastX = clientX;
    p.lastTime = now;
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
      setTimeout(() => { suppressClose.current = false; }, 80);
    }

    if (!p.didMove) {
      // Clean click, no drag — leave rotation alone
    } else if (dist <= 12) {
      startSnap(nearest);
    } else if (Math.abs(p.vel) < 0.3) {
      // Too slow to throw — snap to nearest face
      startSnap(nearest);
    } else {
      startInertia();
    }
  }, [startInertia, startSnap]);

  useEffect(() => {
    function onKey(ev) { if (ev.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      stopAnim();
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

  const normY = ((rotation.y % 360) + 360) % 360;
  const showBackFace = pokeBack && (normY > 90 && normY < 270);

  // Velocity-based X tilt: fast throws make the card lean into the motion
  // Max ±8°, fades out as velocity drops
  const vel = physics.current.vel;
  const tiltX = isDragging
    ? Math.max(-8, Math.min(8, vel * 1.5))
    : Math.max(-4, Math.min(4, vel * 1.2));

  // Dynamic shadow based on rotation
  const shadowAngle = (normY - 180) * (Math.PI / 180);
  const shadowX = -Math.sin(shadowAngle) * 24;
  const shadowBlur = 24 + Math.abs(Math.sin(normY * Math.PI / 180)) * 20;
  const shadowOpacity = 0.45 - Math.abs(Math.sin(normY * Math.PI / 180)) * 0.15;
  const dynamicShadow = `${shadowX.toFixed(1)}px 12px ${shadowBlur.toFixed(1)}px rgba(0,0,0,${shadowOpacity.toFixed(2)})`;

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
              transform: `perspective(1200px) rotateY(${rotation.y.toFixed(2)}deg) rotateX(${tiltX.toFixed(2)}deg) scale(${isDragging ? 1.05 : 1})`,
              transition: isDragging ? 'none' : 'transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
              boxShadow: dynamicShadow,
            }}
          >
            <div className="flip-card-front">
              <img
                src={activeSrc}
                alt={activeAlt}
                draggable={false}
                style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
              />
            </div>
            {pokeBack && (
              <div className="flip-card-back">
                <img
                  src="/card-back.svg"
                  alt="Card back"
                  draggable={false}
                  style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
                />
              </div>
            )}
          </div>
        </div>

        {images.length > 1 && (
          <div className="lightbox-image-tabs">
            {images.map((img, i) => (
              <button
                key={img.id}
                className={`lightbox-tab ${i === activeIndex ? 'active' : ''}`}
                onClick={() => setActiveIndex(i)}
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
