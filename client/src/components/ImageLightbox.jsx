import React, { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api.js';

/*
 * Smooth 3D card spinner.
 *
 * Architecture:
 *  - pointermove only records into a buffer (no DOM writes).
 *  - A single requestAnimationFrame loop handles all rendering,
 *    aligned to the display refresh cycle.
 *  - No React state during drag; transforms written via ref.
 */
export default function ImageLightbox({
  src,
  alt,
  images: initialImages = [],
  onClose,
  cardId: initialCardId,
  related: initialRelated = [],
  onNavigate,
  pokeBack: initialPokeBack = false,
}) {
  const rafRef = useRef(null);
  const suppressClose = useRef(false);
  const flipCardRef = useRef(null);

  const [swapped, setSwapped] = useState(null);
  const cardId = swapped?.cardId ?? initialCardId;
  const cardImages = swapped?.images ?? initialImages;
  const related = swapped?.related ?? initialRelated;
  const pokeBack = swapped?.pokeBack ?? initialPokeBack;
  const baseImage = swapped?.src ?? src;
  const baseAlt = swapped?.alt ?? alt;

  const allImages = cardImages.length > 0
    ? cardImages
    : [{ filename: baseImage.replace('/images/', ''), side: 'front' }];

  const [activeIndex, setActiveIndex] = useState(
    swapped
      ? 0
      : Math.max(0, allImages.findIndex((img) => `/images/${img.filename}` === baseImage))
  );
  const active = allImages[activeIndex] || allImages[0] || null;
  const activeSrc = active ? `/images/${active.filename}` : baseImage;
  const activeAlt = active ? active.side : baseAlt;

  const rotationRef = useRef({ y: 0 });
  const [isDraggingState, setIsDraggingState] = useState(false);
  const isDraggingRef = useRef(false);
  const [loadingRelatedId, setLoadingRelatedId] = useState(null);

  // Physics buffer — written by pointermove, read by rAF loop
  const buf = useRef({
    vel: 0,
    lastX: 0,
    lastTime: 0,
    didMove: false,
    targetY: null,    // when snapping
    snapVel: 0,
    mode: 'idle',     // 'idle' | 'drag' | 'inertia' | 'snap'
  });

  const stopAnim = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  /* ── Render loop: single rAF, reads buf, writes DOM ── */
  function renderFrame() {
    const el = flipCardRef.current;
    if (!el) {
      rafRef.current = requestAnimationFrame(renderFrame);
      return;
    }

    const b = buf.current;

    if (b.mode === 'snap') {
      const curr = rotationRef.current.y;
      const d = b.targetY - curr;
      const STIFFNESS = 0.08;
      const DAMPING = 0.80;
      if (Math.abs(d) < 0.05 && Math.abs(b.snapVel) < 0.05) {
        rotationRef.current = { y: b.targetY };
        b.mode = 'idle';
        b.snapVel = 0;
      } else {
        b.snapVel += d * STIFFNESS;
        b.snapVel *= DAMPING;
        rotationRef.current = { y: curr + b.snapVel };
      }
    }

    if (b.mode === 'inertia') {
      const FRICTION = 0.955;
      if (Math.abs(b.vel) < 0.12) {
        b.vel = 0;
        b.targetY = Math.round(rotationRef.current.y / 360) * 360;
        b.snapVel = 0;
        b.mode = 'snap';
      } else {
        rotationRef.current = { y: rotationRef.current.y + b.vel };
        b.vel *= FRICTION;
      }
    }

    // Build transform
    const y = rotationRef.current.y;
    const normY = ((y % 360) + 360) % 360;
    const dragging = b.mode === 'drag';

    // Smoothed tilt: low-pass on velocity to kill finger jitter
    const v = b.vel;
    const tiltTarget = dragging ? Math.max(-7, Math.min(7, v * 1.2)) : Math.max(-3, Math.min(3, v * 0.8));
    // Simple exponential smoothing — the ref carries the smoothed value
    if (!buf.current._tilt) buf.current._tilt = 0;
    buf.current._tilt += (tiltTarget - buf.current._tilt) * 0.25;
    const tiltX = buf.current._tilt;

    // Cheaper shadow (no sin per frame)
    const edge = Math.abs(normY - 180) / 180; // 0 at front/back, 1 at 90°
    const shadowX = (normY < 180 ? -1 : 1) * edge * 20;
    const shadowBlur = 20 + edge * 16;
    const shadowAlpha = 0.35 + edge * 0.10;
    const shadow = `${shadowX.toFixed(1)}px 14px ${shadowBlur.toFixed(0)}px rgba(0,0,0,${shadowAlpha.toFixed(2)})`;

    const scale = dragging ? 1.04 : 1;

    el.style.transform = `perspective(1400px) rotateY(${y.toFixed(2)}deg) rotateX(${tiltX.toFixed(2)}deg) scale(${scale})`;
    el.style.boxShadow = shadow;

    const stillAnimating = b.mode !== 'idle';
    if (stillAnimating) {
      rafRef.current = requestAnimationFrame(renderFrame);
    } else {
      rafRef.current = null;
      // Settle state with CSS transition for any final nudges
      el.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94), box-shadow 0.3s ease';
    }
  }

  function startRenderLoop() {
    if (!rafRef.current) {
      const el = flipCardRef.current;
      if (el) el.style.transition = 'none';
      rafRef.current = requestAnimationFrame(renderFrame);
    }
  }

  /* ── Input handlers: write only to buffer ── */
  const onPointerDown = useCallback((e) => {
    stopAnim();
    isDraggingRef.current = true;
    setIsDraggingState(true);

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const b = buf.current;
    b.lastX = clientX;
    b.lastTime = performance.now();
    b.vel = 0;
    b.didMove = false;
    b.mode = 'drag';
    suppressClose.current = false;
    startRenderLoop();
    e.preventDefault();
  }, [stopAnim]);

  const onPointerMove = useCallback((e) => {
    if (!isDraggingRef.current) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const now = performance.now();
    const b = buf.current;

    const dx = clientX - b.lastX;
    const dt = now - b.lastTime;
    const sensitivity = 0.30; // slightly lower for smoother feel
    const deltaRot = dx * sensitivity;

    if (Math.abs(dx) > 2) b.didMove = true;
    if (dt > 0) b.vel = (deltaRot / dt) * 16;

    rotationRef.current = { y: rotationRef.current.y + deltaRot };

    b.lastX = clientX;
    b.lastTime = now;
    e.preventDefault();
  }, []);

  const onPointerUp = useCallback(() => {
    isDraggingRef.current = false;
    setIsDraggingState(false);

    const b = buf.current;
    const curr = rotationRef.current.y;
    const nearest = Math.round(curr / 360) * 360;
    const dist = Math.abs(curr - nearest);

    if (b.didMove) {
      suppressClose.current = true;
      setTimeout(() => { suppressClose.current = false; }, 80);
    }

    if (!b.didMove) {
      b.mode = 'idle';
    } else if (dist <= 10) {
      b.targetY = nearest;
      b.snapVel = 0;
      b.mode = 'snap';
      startRenderLoop();
    } else if (Math.abs(b.vel) < 0.25) {
      b.targetY = nearest;
      b.snapVel = 0;
      b.mode = 'snap';
      startRenderLoop();
    } else {
      b.mode = 'inertia';
      startRenderLoop();
    }
  }, []);

  async function swapToRelated(id) {
    if (loadingRelatedId) return;
    setLoadingRelatedId(id);
    try {
      const [card, similar] = await Promise.all([
        api.getCard(id),
        api.similarCards(id),
      ]);
      if (!card) return;
      const imgs = card.images || [];
      const first = imgs[0];
      setSwapped({
        cardId: id,
        images: imgs,
        related: similar,
        src: first ? `/images/${first.filename}` : src,
        alt: card.player_or_character || card.set_name || '',
        pokeBack: /Pokemon/i.test(card.sport_or_game || ''),
      });
      setActiveIndex(0);
      rotationRef.current = { y: 0 };
      buf.current = { vel: 0, lastX: 0, lastTime: 0, didMove: false, targetY: null, snapVel: 0, mode: 'idle', _tilt: 0 };
      stopAnim();
      const el = flipCardRef.current;
      if (el) {
        el.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        el.style.transform = 'perspective(1400px) rotateY(0deg) scale(1)';
      }
    } finally {
      setLoadingRelatedId(null);
    }
  }

  useEffect(() => {
    function onKey(ev) { if (ev.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      stopAnim();
    };
  }, [onClose, stopAnim]);

  useEffect(() => {
    if (!isDraggingRef.current) return;
    const preventScroll = (e) => e.preventDefault();
    window.addEventListener('touchmove', preventScroll, { passive: false });
    return () => window.removeEventListener('touchmove', preventScroll);
  }, [isDraggingState]);

  useEffect(() => {
    if (!isDraggingState) return;
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
  }, [isDraggingState, onPointerMove, onPointerUp]);

  const cursor = isDraggingState ? 'grabbing' : 'grab';

  function handleBackdropClick() {
    if (suppressClose.current) return;
    onClose();
  }

  return (
    <div className="camera-modal lightbox-modal" onClick={handleBackdropClick}>
      <div className="lightbox-layout" onClick={(e) => e.stopPropagation()}>
        <div
          className="lightbox-3d-card"
          style={{ cursor, touchAction: 'none' }}
          onMouseDown={onPointerDown}
          onTouchStart={onPointerDown}
        >
          <div ref={flipCardRef} className="flip-card" style={{ willChange: 'transform' }}>
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

        {allImages.length > 1 && (
          <div className="lightbox-image-tabs">
            {allImages.map((img, i) => (
              <button
                key={img.id || img.filename}
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
                <div key={r.id} className={`lightbox-related-card ${loadingRelatedId === r.id ? 'loading' : ''}`}>
                  {r.image ? (
                    <img
                      src={r.image}
                      alt={r.player_or_character || r.set_name}
                      loading="lazy"
                      onClick={() => swapToRelated(r.id)}
                    />
                  ) : (
                    <div className="lightbox-related-noimg" onClick={() => swapToRelated(r.id)}>?</div>
                  )}
                  <button className="btn small" onClick={() => onNavigate(r.id)}>View Detail</button>
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
