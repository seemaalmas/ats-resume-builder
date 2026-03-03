'use client';

import { TemplatePreviewFrame } from './TemplatePreviewFrame';

type TemplateSamplePdfPreviewProps = {
  pdfUrl: string;
  interactive?: boolean;
};

export default function TemplateSamplePdfPreview({ pdfUrl, interactive = false }: TemplateSamplePdfPreviewProps) {
  return (
    <div className="template-sample-pdf">
      <TemplatePreviewFrame>
        <iframe
          className="template-sample-pdf__frame"
          src={`${pdfUrl}#page=1&view=FitH&toolbar=0&navpanes=0&scrollbar=0`}
          title="Template PDF sample"
          loading="lazy"
          tabIndex={interactive ? 0 : -1}
          aria-hidden={interactive ? undefined : 'true'}
          style={{ pointerEvents: interactive ? 'auto' : 'none' }}
        />
      </TemplatePreviewFrame>
    </div>
  );
}
