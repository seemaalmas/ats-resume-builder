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
  pageWidth?: number;
  pageHeight?: number;
  mode?: 'full' | 'thumbnail';
};

export function TemplatePreviewFrame({
  children,
  pageWidth = TEMPLATE_PAGE_WIDTH,
  pageHeight = TEMPLATE_PAGE_HEIGHT,
  mode = 'full',
}: TemplatePreviewFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const updateScale = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const nextScale = computePreviewScale(rect.width, rect.height, pageWidth, pageHeight);
    setScale((prev) => (Math.abs(prev - nextScale) > 0.001 ? nextScale : prev));
  }, [pageHeight, pageWidth]);

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
    <div className="template-preview-frame__container" data-preview-frame-mode={mode} ref={containerRef}>
      <div
        className={`template-preview-frame__page${mode === 'thumbnail' ? ' template-preview-frame__page--thumbnail' : ''}`}
        style={{ transform: `scale(${scale})${mode === 'full' ? ' translateZ(0)' : ''}`, width: pageWidth, height: pageHeight }}
      >
        <div className="template-preview-frame__content">{children}</div>
      </div>
    </div>
  );
}
