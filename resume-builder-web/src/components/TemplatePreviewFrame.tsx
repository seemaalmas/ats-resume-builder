'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export const TEMPLATE_PAGE_WIDTH = 794;
export const TEMPLATE_PAGE_HEIGHT = 1123;

export function computePreviewScale(containerWidth: number, containerHeight: number, pageWidth = TEMPLATE_PAGE_WIDTH, pageHeight = TEMPLATE_PAGE_HEIGHT) {
  if (!containerWidth || !containerHeight) return 1;
  const scale = Math.min(containerWidth / pageWidth, containerHeight / pageHeight);
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(scale, 1);
}

type TemplatePreviewFrameProps = {
  children: ReactNode;
};

export function TemplatePreviewFrame({ children }: TemplatePreviewFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const updateScale = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const nextScale = computePreviewScale(rect.width, rect.height);
    setScale((prev) => (Math.abs(prev - nextScale) > 0.001 ? nextScale : prev));
  }, []);

  useEffect(() => {
    updateScale();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateScale) : null;
    if (observer && containerRef.current) {
      observer.observe(containerRef.current);
    }
    window.addEventListener('resize', updateScale);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateScale);
    };
  }, [updateScale]);

  return (
    <div className="template-preview-frame__container" ref={containerRef}>
      <div
        className="template-preview-frame__page"
        style={{ transform: `scale(${scale}) translateZ(0)`, width: TEMPLATE_PAGE_WIDTH, height: TEMPLATE_PAGE_HEIGHT }}
      >
        <div className="template-preview-frame__content">{children}</div>
      </div>
    </div>
  );
}
