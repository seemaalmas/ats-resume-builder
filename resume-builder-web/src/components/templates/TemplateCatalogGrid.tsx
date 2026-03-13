'use client';

import { memo } from 'react';
import type { ResumeImportResult } from 'resume-builder-shared';
import ResumeTemplateRender from '@/src/components/ResumeTemplateRender';
import type { TemplateRecommendation } from '@/src/lib/template-recommendation';
import type { TemplateConfig, TemplateId } from '@/shared/templateRegistry';

type TemplateCardThumbnailProps = {
  templateId: TemplateId;
  previewResume: ResumeImportResult | null;
  previewLoading?: boolean;
};

const TemplateCardThumbnailLoading = memo(function TemplateCardThumbnailLoading() {
  return (
    <div
      className="template-card__thumbnail template-card__thumbnail--loading"
      data-preview-kind="thumbnail"
      data-thumbnail-state="loading"
      data-thumbnail-component="TemplateCardThumbnailLoading"
    >
      <p className="small template-card__thumbnail-loading-copy">Loading preview...</p>
    </div>
  );
});

TemplateCardThumbnailLoading.displayName = 'TemplateCardThumbnailLoading';

const TemplateCardThumbnail = memo(function TemplateCardThumbnail({
  templateId,
  previewResume,
  previewLoading = false,
}: TemplateCardThumbnailProps) {
  if (!previewResume) {
    return previewLoading ? <TemplateCardThumbnailLoading /> : null;
  }

  return (
    <div
      className="template-card__thumbnail"
      data-preview-kind="thumbnail"
      data-thumbnail-state="live"
      data-thumbnail-component="ResumeTemplateRender"
    >
      <ResumeTemplateRender templateId={templateId} resumeData={previewResume} mode="thumbnail" />
    </div>
  );
});

TemplateCardThumbnail.displayName = 'TemplateCardThumbnail';

type TemplateCatalogGridProps = {
  templates: TemplateConfig[];
  previewResume: ResumeImportResult | null;
  selectedTemplate: TemplateId | '';
  recommendation?: TemplateRecommendation | null;
  hoveredTemplate?: TemplateId | '';
  onHoverTemplate?: (templateId: TemplateId | '') => void;
  onPreviewTemplate?: (templateId: TemplateId) => void;
  onSelectTemplate: (templateId: TemplateId) => void;
  primaryActionLabel?: string;
  layoutVariant?: 'list' | 'gallery';
  disabled?: boolean;
  previewLoading?: boolean;
  dataTestId?: string;
};

export default function TemplateCatalogGrid({
  templates,
  previewResume,
  selectedTemplate,
  recommendation,
  hoveredTemplate = '',
  onHoverTemplate,
  onPreviewTemplate,
  onSelectTemplate,
  primaryActionLabel = 'Preview',
  layoutVariant = 'list',
  disabled = false,
  previewLoading = false,
  dataTestId,
}: TemplateCatalogGridProps) {
  return (
    <div
      className={`template-grid ${layoutVariant === 'gallery' ? 'template-grid--gallery' : 'template-grid--list'}`}
      data-testid={dataTestId}
      data-layout-variant={layoutVariant}
    >
      {templates.map((template) => {
        const isApplied = Boolean(selectedTemplate) && template.id === selectedTemplate;
        const isRecommended = template.id === recommendation?.primaryTemplateId;
        const showRecommendedReason = Boolean(isRecommended && recommendation?.reasons[0]);
        const isPreviewing = template.id === hoveredTemplate;
        const previewHandler = onPreviewTemplate || onSelectTemplate;
        const showPreviewAction = Boolean(onPreviewTemplate);

        const handlePreview = () => {
          if (disabled) return;
          previewHandler(template.id);
        };

        const handlePrimaryAction = () => {
          if (disabled) return;
          onSelectTemplate(template.id);
        };

        return (
          <article
            key={template.id}
            className={`template-card ${isApplied ? 'active' : ''}`}
            data-template-id={template.id}
            onClick={() => {
              if (disabled) return;
              previewHandler(template.id);
            }}
            onKeyDown={(event) => {
              if (disabled) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                previewHandler(template.id);
              }
            }}
            role="button"
            tabIndex={disabled ? -1 : 0}
            onMouseEnter={() => onHoverTemplate?.(template.id)}
            onMouseLeave={() => onHoverTemplate?.('')}
          >
            <div
              className="template-card__preview template-card__preview--interactive"
              onClick={(event) => {
                event.stopPropagation();
                handlePreview();
              }}
            >
              <TemplateCardThumbnail templateId={template.id} previewResume={previewResume} previewLoading={previewLoading} />
              <button
                type="button"
                className="template-card__preview-overlay template-card__preview-overlay-button"
                onClick={(event) => {
                  event.stopPropagation();
                  handlePreview();
                }}
                disabled={disabled}
              >
                Open preview
              </button>
            </div>
            <div className="template-card__meta">
              <div>
                <strong>{template.name}</strong>
                <div className="small">{template.description}</div>
                <div className="small template-card__availability">{template.tags.join(' | ')}</div>
                {showRecommendedReason && (
                  <p className="small template-card__reason">
                    Why recommended? {recommendation?.reasons[0]}
                  </p>
                )}
              </div>
              <div className="template-card__meta-badges">
                <span className="pill">{isApplied ? 'Applied' : isPreviewing ? 'Previewing' : 'Available'}</span>
                {isRecommended && (
                  <span className="pill recommended" title={(recommendation?.reasons || []).join(' ')}>
                    Recommended
                  </span>
                )}
              </div>
              <div className="template-card__actions">
                {showPreviewAction && (
                  <button
                    type="button"
                    className="btn secondary template-card__action"
                    onClick={(event) => {
                      event.stopPropagation();
                      handlePreview();
                    }}
                    disabled={disabled}
                  >
                    Preview
                  </button>
                )}
                <button
                  type="button"
                  className="btn template-card__action"
                  onClick={(event) => {
                    event.stopPropagation();
                    handlePrimaryAction();
                  }}
                  disabled={disabled}
                >
                  {primaryActionLabel}
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
