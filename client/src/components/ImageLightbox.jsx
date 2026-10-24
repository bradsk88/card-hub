import React, { useEffect, useRef, useState, useCallback } from 'react';

/*
 * Interactive 3D card spinner for the deck/lightbox view.
 * Grab the image, drag to spin, release to throw with inertia.
 * Click the dark backdrop or the ✕ button to close.
 */
export default function ImageLightbox({ src, alt, onClose }) {
  const imgRef = useRef(null);
  const containerRef = useRef(null);
  const rafRef = useRef(null);

  const [rotation, setRotation] = useState({ y: 6, x: 2 });
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

  const stopInertia = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startInertia = useCallback(() => {
    stopInertia();
    const loop = () => {
      const p = physics.current;
      if (Math.abs(p.velY) < p.minVel && Math.abs(p.velX) < p.minVel) {
        p.velY = 0;
        p.velX = 0;
        rafRef.current = null;
        return;
      }
      setRotation((prev) => {
        const next = { y: prev.y + p.velY, x: prev.x + p.velX };
        // Clamp X tilt so we don’t flip upside-down
        next.x = Math.max(-30, Math.min(30, next.x));
        return next;
      });
      p.velY *= p.friction;
      p.velX *= p.friction;
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [stopInertia]);

  const onPointerDown = useCallback((e) => {
    stopInertia();
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
  }, [stopInertia]);

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
      p.velY = deltaY / dt * 16; // scale to ~60fps
      p.velX = deltaX / dt * 16;
    }

    setRotation((prev) => {
      const next = { y: prev.y + deltaY, x: prev.x + deltaX };
      next.x = Math.max(-30, Math.min(30, next.x));
      return next;
    });

    p.lastX = clientX;
    p.lastY = clientY;
    p.lastTime = now;
    e.preventDefault();
  }, [isDragging]);

  const onPointerUp = useCallback(() => {
    setIsDragging(false);
    startInertia();
  }, [startInertia]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      stopInertia();
    };
  }, [onClose, stopInertia]);

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
      <div
        ref={containerRef}
        className="lightbox-3d-card"
        style={{ cursor, touchAction: 'none' }}
        onMouseDown={onPointerDown}
        onTouchStart={onPointerDown}
        onClick={(e) => e.stopPropagation()}
      >
        <img
          ref={imgRef}
          className="lightbox-img"
          src={src}
          alt={alt}
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
      <button className="btn lightbox-close" onClick={onClose}>✕</button>
    </div>
  );
}
