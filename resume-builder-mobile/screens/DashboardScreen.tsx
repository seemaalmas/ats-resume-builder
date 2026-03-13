import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import TemplateCard, { type TemplateCardItem } from '../components/TemplateCard';

/**
 * Template catalog matching the web's TEMPLATE_CATALOG from resume-builder-shared.
 * Kept in sync manually until the shared package is linked as a dependency.
 */
const TEMPLATE_CATALOG: TemplateCardItem[] = [
  {
    id: 'classic',
    name: 'Classic ATS',
    description: 'Single-column, clean layout optimized for ATS parsers.',
    tags: ['ATS-safe', 'Classic'],
  },
  {
    id: 'modern',
    name: 'Modern Professional',
    description: 'Clean modern layout with subtle divider lines.',
    tags: ['ATS-safe', 'Modern'],
  },
  {
    id: 'executive',
    name: 'Executive Impact',
    description: 'Leadership-focused layout with strong visual hierarchy.',
    tags: ['ATS-safe', 'Leadership'],
  },
  {
    id: 'technical',
    name: 'Technical Compact',
    description: 'Dense layout for technical roles with many skills.',
    tags: ['ATS-safe', 'Technical'],
  },
  {
    id: 'minimal',
    name: 'Minimal Clean',
    description: 'Ultra-minimal recruiter-friendly layout.',
    tags: ['ATS-safe', 'Minimal'],
  },
  {
    id: 'consultant',
    name: 'Consultant Clean',
    description: 'Consulting and strategy-focused layout.',
    tags: ['ATS-safe', 'Consulting'],
  },
];

type DashboardScreenProps = {
  onNavigateToTemplate: (templateId: string) => void;
  selectedTemplateId?: string;
  recommendedTemplateId?: string;
  recommendedReason?: string;
};

export default function DashboardScreen({
  onNavigateToTemplate,
  selectedTemplateId,
  recommendedTemplateId,
  recommendedReason,
}: DashboardScreenProps) {
  const templates = TEMPLATE_CATALOG.map((t) => ({
    ...t,
    isSelected: t.id === selectedTemplateId,
    isRecommended: t.id === recommendedTemplateId,
    recommendedReason: t.id === recommendedTemplateId ? recommendedReason : undefined,
  }));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Dashboard</Text>
        <Text style={styles.subtitle}>Choose a resume, then browse ATS-safe templates.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Choose a template</Text>
        <Text style={styles.sectionHint}>
          Same catalog as template selection, optimized for ATS-safe export.
        </Text>
      </View>

      <View style={styles.grid}>
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onPreview={(id) => onNavigateToTemplate(id)}
            onSelect={(id) => onNavigateToTemplate(id)}
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
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#172332',
  },
  subtitle: {
    fontSize: 14,
    color: '#5a6778',
    marginTop: 4,
  },
  section: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#172332',
  },
  sectionHint: {
    fontSize: 13,
    color: '#5a6778',
    marginTop: 4,
  },
  grid: {
    gap: 16,
  },
});
