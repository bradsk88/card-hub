import React, { useEffect, useRef, useState, useCallback } from 'react';

/*
 * Interactive 3D card spinner for the deck/lightbox view.
 * Grab the image, drag to spin, release to throw with inertia.
 * Shows a strip of related (same-name) cards below the main image.
 * If released within 10° of front-facing, snaps smoothly back.
 * Click the dark backdrop or the ✕ button to close.
 */
export default function ImageLightbox({ src, alt, images = [], onClose, cardId, related = [], onNavigate }) {
  const rafRef = useRef(null);

  // Which image tab is active (only relevant when images.length > 1)
  const initialIndex = images.length > 0
    ? Math.max(0, images.findIndex((img) => `/images/${img.filename}` === src))
    : 0;
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const active = images[activeIndex] || null;
  const activeSrc = active ? `/images/${active.filename}` : src;
  const activeAlt = active ? active.side : alt;

  const [rotation, setRotation] = useState({ y: 6, x: 2 });
  const rotationRef = useRef({ y: 6, x: 2 });
  useEffect(() => { rotationRef.current = rotation; }, [rotation]);

  const [isDragging, setIsDragging] = useState(false);

  // Physics state stored in refs to avoid re-render churn during rAF
  const physics = useRef({
    velY: 0,
    velX: 0,
    lastX: 0,
    lastY: 0,
    lastTime: 0,
    friction: 0.96,
    minVel: 0.05,
  });

  const filteredRel = related.filter((r) => r.id !== cardId);

  const stopAnim = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startSnap = useCallback((target) => {
    stopAnim();
    const loop = () => {
      const curr = rotationRef.current;
      const dy = target.y - curr.y;
      const dx = target.x - curr.x;
      if (Math.abs(dy) < 0.06 && Math.abs(dx) < 0.06) {
        rotationRef.current = target;
        setRotation(target);
        rafRef.current = null;
        return;
      }
      const next = {
        y: curr.y + dy * 0.10,
        x: curr.x + dx * 0.10,
      };
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
      if (Math.abs(p.velY) < p.minVel && Math.abs(p.velX) < p.minVel) {
        p.velY = 0;
        p.velX = 0;
        rafRef.current = null;
        return;
      }
      const curr = rotationRef.current;
      const next = { y: curr.y + p.velY, x: curr.x + p.velX };
      next.x = Math.max(-30, Math.min(30, next.x));
      rotationRef.current = next;
      setRotation(next);
      p.velY *= p.friction;
      p.velX *= p.friction;
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [stopAnim]);

  const onPointerDown = useCallback((e) => {
    stopAnim();
    setIsDragging(true);
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const p = physics.current;
    p.lastX = clientX;
    p.lastY = clientY;
    p.lastTime = performance.now();
    p.velY = 0;
    p.velX = 0;
    e.preventDefault();
  }, [stopAnim]);

  const onPointerMove = useCallback((e) => {
    if (!isDragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const now = performance.now();
    const p = physics.current;

    const dx = clientX - p.lastX;
    const dy = clientY - p.lastY;
    const dt = now - p.lastTime;

    // Sensitivity: horizontal drag spins around Y; vertical drag tilts X
    const sensitivity = 0.35;
    const deltaY = dx * sensitivity;
    const deltaX = -dy * sensitivity * 0.5;

    if (dt > 0) {
      p.velY = (deltaY / dt) * 16; // scale to ~60fps
      p.velX = (deltaX / dt) * 16;
    }

    const next = {
      y: rotationRef.current.y + deltaY,
      x: rotationRef.current.x + deltaX,
    };
    next.x = Math.max(-30, Math.min(30, next.x));
    rotationRef.current = next;
    setRotation(next);

    p.lastX = clientX;
    p.lastY = clientY;
    p.lastTime = now;
    e.preventDefault();
  }, [isDragging]);

  const onPointerUp = useCallback(() => {
    setIsDragging(false);
    const curr = rotationRef.current;
    const nearestY = Math.round(curr.y / 360) * 360;
    const distY = Math.abs(curr.y - nearestY);
    const distX = Math.abs(curr.x);

    if (distY <= 10 && distX <= 10) {
      startSnap({ y: nearestY, x: 0 });
    } else {
      startInertia();
    }
  }, [startInertia, startSnap]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      stopAnim();
    };
  }, [onClose, stopAnim]);

  // Prevent scrolling while dragging inside lightbox
  useEffect(() => {
    if (!isDragging) return;
    const preventScroll = (e) => e.preventDefault();
    window.addEventListener('touchmove', preventScroll, { passive: false });
    return () => window.removeEventListener('touchmove', preventScroll);
  }, [isDragging]);

  // Global move/up listeners so drag works even if cursor leaves the element
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

  return (
    <div className="camera-modal lightbox-modal" onClick={onClose}>
      <div className="lightbox-layout">
        <div
          className="lightbox-3d-card"
          style={{ cursor, touchAction: 'none' }}
          onMouseDown={onPointerDown}
          onTouchStart={onPointerDown}
          onClick={(e) => e.stopPropagation()}
        >
          <img
            className="lightbox-img"
            src={activeSrc}
            alt={activeAlt}
            draggable={false}
            style={{
              transform: `perspective(1200px) rotateY(${rotation.y.toFixed(2)}deg) rotateX(${rotation.x.toFixed(2)}deg)`,
              transition: isDragging ? 'none' : 'transform 0.1s ease-out',
              userSelect: 'none',
              WebkitUserSelect: 'none',
            }}
          />
          <p className="lightbox-hint">{isDragging ? '' : 'Click & drag to spin'}</p>
        </div>

        {images.length > 1 && (
          <div className="lightbox-image-tabs" onClick={(e) => e.stopPropagation()}>
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

        {filteredRel.length > 0 && (
          <div className="lightbox-related" onClick={(e) => e.stopPropagation()}>
            <p className="lightbox-related-label">Other versions in collection:</p>
            <div className="lightbox-related-strip">
              {filteredRel.map((r) => (
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
                  <button className="btn small" onClick={() => onNavigate(r.id)}>
                    View
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <button className="btn lightbox-close" onClick={onClose}>✕</button>
    </div>
  );
}
