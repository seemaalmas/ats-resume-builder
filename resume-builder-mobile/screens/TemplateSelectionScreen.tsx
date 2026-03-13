import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import TemplateCard, { type TemplateCardItem } from '../components/TemplateCard';

const TEMPLATE_CATALOG: TemplateCardItem[] = [
  { id: 'classic', name: 'Classic ATS', description: 'Single-column, clean ATS layout.', tags: ['ATS-safe', 'Classic'] },
  { id: 'modern', name: 'Modern Professional', description: 'Clean modern with divider lines.', tags: ['ATS-safe', 'Modern'] },
  { id: 'executive', name: 'Executive Impact', description: 'Leadership-focused hierarchy.', tags: ['ATS-safe', 'Leadership'] },
  { id: 'technical', name: 'Technical Compact', description: 'Dense technical layout.', tags: ['ATS-safe', 'Technical'] },
  { id: 'minimal', name: 'Minimal Clean', description: 'Ultra-minimal recruiter-friendly.', tags: ['ATS-safe', 'Minimal'] },
  { id: 'consultant', name: 'Consultant Clean', description: 'Consulting/strategy style.', tags: ['ATS-safe', 'Consulting'] },
];

type TemplateSelectionScreenProps = {
  initialTemplateId?: string;
  onGoBack: () => void;
  onApplyTemplate: (templateId: string) => void;
};

export default function TemplateSelectionScreen({
  initialTemplateId = 'classic',
  onGoBack,
  onApplyTemplate,
}: TemplateSelectionScreenProps) {
  const [selectedId, setSelectedId] = useState(initialTemplateId);
  const selectedMeta = TEMPLATE_CATALOG.find((t) => t.id === selectedId) || TEMPLATE_CATALOG[0];

  const templates = TEMPLATE_CATALOG.map((t) => ({
    ...t,
    isSelected: t.id === selectedId,
  }));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onGoBack}>
          <Text style={styles.backBtn}>Back to Dashboard</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Choose a template</Text>
        <Text style={styles.subtitle}>Pick the layout you want before exporting.</Text>
      </View>

      {/* Live preview area — mirrors web's right-side preview */}
      <View style={styles.previewPane}>
        <View style={styles.previewHeader}>
          <Text style={styles.previewTitle}>Live preview</Text>
          <Text style={styles.previewTemplateName}>Now viewing {selectedMeta.name}</Text>
        </View>
        <View style={styles.previewCanvas}>
          <Text style={styles.previewTemplateLabel}>{selectedMeta.name}</Text>
          <Text style={styles.previewTemplateDesc}>{selectedMeta.description}</Text>
          <Text style={styles.previewNote}>
            Full template preview renders via WebView in production builds.
          </Text>
        </View>
        <View style={styles.previewActions}>
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={() => onApplyTemplate(selectedId)}
          >
            <Text style={styles.btnPrimaryText}>Use Template</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnSecondary} onPress={onGoBack}>
            <Text style={styles.btnSecondaryText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Template cards — mirrors web's left-side card list */}
      <View style={styles.cardList}>
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onPreview={(id) => setSelectedId(id)}
            onSelect={(id) => {
              setSelectedId(id);
              onApplyTemplate(id);
            }}
          />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f5f8',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 16,
  },
  backBtn: {
    color: '#2f5f8f',
    fontWeight: '600',
    fontSize: 14,
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#172332',
  },
  subtitle: {
    fontSize: 13,
    color: '#5a6778',
    marginTop: 4,
  },
  previewPane: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d9e3ec',
    padding: 16,
    marginBottom: 20,
  },
  previewHeader: {
    marginBottom: 12,
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#172332',
  },
  previewTemplateName: {
    fontSize: 13,
    color: '#5a6778',
    marginTop: 2,
  },
  previewCanvas: {
    borderWidth: 1,
    borderColor: '#dfe7ef',
    borderRadius: 12,
    padding: 20,
    backgroundColor: '#fff',
    minHeight: 280,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewTemplateLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: '#172332',
  },
  previewTemplateDesc: {
    fontSize: 13,
    color: '#5a6778',
    marginTop: 6,
    textAlign: 'center',
  },
  previewNote: {
    fontSize: 11,
    color: '#8a96a6',
    marginTop: 12,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  previewActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  btnPrimary: {
    flex: 1,
    backgroundColor: '#2f5f8f',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnPrimaryText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  btnSecondary: {
    flex: 1,
    backgroundColor: '#eef3f8',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d2deea',
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnSecondaryText: {
    color: '#213750',
    fontWeight: '600',
    fontSize: 14,
  },
  cardList: {
    gap: 16,
  },
});
